-- =====================================================================
-- BOT CONTENT — HÀM ĐIỀU PHỐI (giai đoạn C, D, E)
--
-- Runner trên máy Duy và bộ máy dự phòng không giữ khóa database: chúng gọi Edge Function
-- content-api / content-fallback, và các hàm đó chỉ gọi các hàm SQL dưới đây — mỗi hàm tự
-- kiểm la_may_chu() và chỉ chạm các bảng content_*. (Blueprint luật 4: agent nền tự giới hạn phạm vi.)
--
-- Thứ tự nhận việc: bài cần viết lại → yêu cầu /vietngay → khung giờ đến hạn (08:00 house, 20:00 bedding).
-- Hàng đợi trống thì KHÔNG tự nghĩ chủ đề: không có việc.
-- Khóa: claimed_by + claimed_at; khóa quá 30 phút coi như bộ máy đã chết, việc được nhận lại.
-- =====================================================================

-- Bot đang chờ Duy nhắn yêu cầu sửa sau khi bấm "Viết lại"
create table public.content_cho_phan_hoi (
  chat_id    bigint not null,
  brand      text   not null check (brand in ('house', 'bedding')),
  post_id    bigint not null references public.content_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, brand)
);
alter table public.content_cho_phan_hoi enable row level security;
create policy "content_cho_phan_hoi: admin" on public.content_cho_phan_hoi for all using (is_admin()) with check (is_admin());
revoke all on public.content_cho_phan_hoi from anon;

-- Bản rút gọn skill thương hiệu cho bộ máy dự phòng (runner tải lên từ SKILL.md — cùng một nguồn giọng văn)
create table public.content_skill (
  brand      text primary key check (brand in ('house', 'bedding')),
  noi_dung   text not null,
  hash       text not null,
  updated_at timestamptz not null default now()
);
alter table public.content_skill enable row level security;
create policy "content_skill: xem" on public.content_skill for select using (can_view_content());
revoke all on public.content_skill from anon;

-- ---------- Tên agent ghi vào nhật ký ----------
create or replace function public.content_ten_agent(p_brand text, p_engine text) returns text
language sql immutable set search_path = public as $$
  select 'Content ' || case p_brand when 'house' then 'House' else 'Bedding' end
         || case p_engine when 'du_phong' then ' (dự phòng)' else ' (Claude)' end
$$;

-- ---------- Giờ khung của từng thương hiệu (giờ Việt Nam) ----------
create or replace function public.content_gio_khung(p_brand text) returns time
language sql immutable as $$
  select case p_brand when 'house' then time '08:00' else time '20:00' end
$$;

-- ---------- Lấy chủ đề kế tiếp (đánh dấu đã dùng) ----------
create or replace function public.content_lay_chu_de(p_brand text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  select id into v from content_topics
   where brand = p_brand and status = 'cho'
   order by priority desc, created_at, id
   limit 1 for update skip locked;
  if v is not null then update content_topics set status = 'da_dung' where id = v; end if;
  return v;
end $$;

-- ---------- Gói việc trả cho bộ máy viết ----------
create or replace function public.content_goi_viec(p_post bigint, p_loai text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'post_id', p.id, 'loai', p_loai, 'brand', p.brand,
    'chu_de', t.topic, 'dinh_dang', t.format, 'ghi_chu', t.notes,
    'phien_ban_moi', p.current_version + 1,
    'yeu_cau_sua', p.feedback_pending,
    'ban_truoc', (select v.body from content_versions v where v.post_id = p.id and v.version_no = p.current_version))
  from content_posts p left join content_topics t on t.id = p.topic_id
  where p.id = p_post
$$;

-- ---------- Nhận việc ----------
-- p_ai: 'may-duy' (runner) | 'du-phong'
-- p_chi_khung_gio: bộ máy dự phòng chỉ lo khung giờ trong ngày, không viết lại, không /vietngay
-- p_luc: thời điểm xét khung giờ (mặc định bây giờ; test truyền vào để giả lập 08:00 / 20:00)
create or replace function public.content_nhan_viec(p_ai text, p_chi_khung_gio boolean default false,
                                                    p_brand text default null, p_luc timestamptz default now())
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_vn   timestamp := p_luc at time zone 'Asia/Ho_Chi_Minh';
  v_ngay date := (p_luc at time zone 'Asia/Ho_Chi_Minh')::date;
  v_cu   timestamptz := now() - interval '30 minutes';
  v_post bigint; v_topic bigint; v_b text;
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ nhận việc viết bài'; end if;
  if p_ai not in ('may-duy', 'du-phong') then raise exception 'Bộ máy không hợp lệ: %', p_ai; end if;

  if not p_chi_khung_gio then
    -- 1) Bài cần viết lại (hoặc đang viết lại mà bộ máy trước đã chết)
    select id into v_post from content_posts
     where deleted_at is null and (p_brand is null or brand = p_brand) and current_version > 0
       and (status = 'can_viet_lai' or (status = 'dang_viet' and claimed_at < v_cu))
     order by updated_at, id limit 1 for update skip locked;
    if v_post is not null then
      update content_posts set status = 'dang_viet', claimed_by = p_ai, claimed_at = now() where id = v_post;
      return content_goi_viec(v_post, 'viet_lai');
    end if;

    -- 2) Yêu cầu /vietngay, hoặc bài khung giờ bị bỏ dở
    for v_post in
      select id from content_posts
       where deleted_at is null and (p_brand is null or brand = p_brand) and current_version = 0
         and (status = 'cho_viet' or (status = 'dang_viet' and claimed_at < v_cu))
       order by created_at, id for update skip locked
    loop
      if (select topic_id from content_posts where id = v_post) is null then
        v_topic := content_lay_chu_de((select brand from content_posts where id = v_post));
        if v_topic is null then continue; end if;          -- hàng đợi trống: để yêu cầu nằm chờ
        update content_posts set topic_id = v_topic where id = v_post;
      end if;
      update content_posts set status = 'dang_viet', claimed_by = p_ai, claimed_at = now() where id = v_post;
      return content_goi_viec(v_post, 'viet_ngay');
    end loop;
  end if;

  -- 3) Khung giờ trong ngày đã đến
  foreach v_b in array array['house', 'bedding'] loop
    continue when p_brand is not null and v_b <> p_brand;
    continue when v_vn::time < content_gio_khung(v_b);

    -- Khung đã có bài: dự phòng chỉ nhận lại nếu bài đó chưa được viết và đang bỏ dở
    select s.post_id into v_post from content_slots s where s.slot_date = v_ngay and s.brand = v_b;
    if v_post is not null then
      if p_chi_khung_gio then
        select id into v_post from content_posts
         where id = v_post and current_version = 0 and deleted_at is null
           and (status = 'cho_viet' or (status = 'dang_viet' and claimed_at < v_cu))
         for update skip locked;
        if v_post is not null then
          update content_posts set status = 'dang_viet', claimed_by = p_ai, claimed_at = now() where id = v_post;
          return content_goi_viec(v_post, 'khung_gio');
        end if;
      end if;
      continue;
    end if;

    begin
      -- lấy chủ đề BÊN TRONG khối này: bị bộ máy kia giành mất khung thì chủ đề được hoàn tác, không mất
      v_topic := content_lay_chu_de(v_b);
      continue when v_topic is null;                      -- hàng đợi trống: bỏ qua khung này
      insert into content_posts (brand, topic_id, status, claimed_by, claimed_at)
      values (v_b, v_topic, 'dang_viet', p_ai, now()) returning id into v_post;
      insert into content_slots (slot_date, brand, post_id) values (v_ngay, v_b, v_post);
      return content_goi_viec(v_post, 'khung_gio');
    exception when unique_violation then
      continue;                                           -- bộ máy kia vừa giành khung này: hoàn tác phần trên
    end;
  end loop;
  return null;
end $$;

-- ---------- Nộp bài ----------
create or replace function public.content_nop_bai(p_post bigint, p_ai text, p_body text, p_engine text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare p public.content_posts%rowtype; v_no int;
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ nộp bài'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'Bài rỗng'; end if;
  select * into p from content_posts where id = p_post for update;
  if not found or p.status <> 'dang_viet' or p.claimed_by is distinct from p_ai then
    raise exception 'Bộ máy % không giữ bài #% (có thể đã hết hạn khóa)', p_ai, p_post;
  end if;
  perform set_config('mo.tac_nhan', content_ten_agent(p.brand, p_engine), true);
  v_no := p.current_version + 1;
  insert into content_versions (post_id, version_no, body, feedback_before, engine)
  values (p_post, v_no, p_body, p.feedback_pending, p_engine);
  update content_posts set current_version = v_no, status = 'cho_duyet', feedback_pending = null,
         engine = p_engine, claimed_by = null, claimed_at = null
   where id = p_post;
  return content_goi_viec(p_post, 'da_nop') || jsonb_build_object('phien_ban', v_no, 'engine', p_engine, 'body', p_body);
end $$;

-- ---------- Nhả việc khi lỗi ----------
create or replace function public.content_nha_viec(p_post bigint, p_ai text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ nhả việc'; end if;
  update content_posts
     set status = case when current_version = 0 then 'cho_viet' else 'can_viet_lai' end,
         claimed_by = null, claimed_at = null
   where id = p_post and status = 'dang_viet' and claimed_by = p_ai;
end $$;

-- ---------- Việc phụ cho bot ----------
create or replace function public.content_gan_tin(p_post bigint, p_msg bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ'; end if;
  update content_posts set telegram_message_id = p_msg where id = p_post;
end $$;

-- Chat Telegram của các admin đã liên kết (nơi nhận nháp)
create or replace function public.content_chat_admin() returns setof bigint
language plpgsql stable security definer set search_path = public as $$
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ'; end if;
  return query select l.chat_id from telegram_links l join profiles p on p.id = l.profile_id
                where l.revoked_at is null and p.status = 'approved' and p.role = 'admin';
end $$;

create or replace function public.content_dem_hang_doi(p_brand text) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not (la_may_chu() or can_view_content()) then raise exception 'Không có quyền'; end if;
  return (select count(*) from content_topics where brand = p_brand and status = 'cho');
end $$;

create or replace function public.content_luu_skill(p_brand text, p_noi_dung text, p_hash text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ'; end if;
  insert into content_skill (brand, noi_dung, hash) values (p_brand, p_noi_dung, p_hash)
  on conflict (brand) do update set noi_dung = excluded.noi_dung, hash = excluded.hash, updated_at = now();
end $$;

create or replace function public.content_lay_skill(p_brand text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ'; end if;
  return (select jsonb_build_object('noi_dung', noi_dung, 'hash', hash) from content_skill where brand = p_brand);
end $$;

-- ---------- Quyền gọi hàm (mục 9.3b) ----------
do $$
declare f text;
begin
  foreach f in array array[
    'content_lay_chu_de(text)', 'content_goi_viec(bigint, text)', 'content_nhan_viec(text, boolean, text, timestamptz)',
    'content_nop_bai(bigint, text, text, text)', 'content_nha_viec(bigint, text)', 'content_gan_tin(bigint, bigint)',
    'content_chat_admin()', 'content_luu_skill(text, text, text)', 'content_lay_skill(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.content_dem_hang_doi(text) from public, anon;
grant execute on function public.content_dem_hang_doi(text) to authenticated, service_role;
revoke all on function public.content_ten_agent(text, text), public.content_gio_khung(text) from public, anon;
grant execute on function public.content_ten_agent(text, text), public.content_gio_khung(text) to authenticated, service_role;
