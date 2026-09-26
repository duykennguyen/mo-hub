-- =====================================================================
-- THƯ KÍ KIỂM QUYỀN THEO NGƯỜI NHẮN
--
-- Trước đây bot chạy bằng service role (bỏ qua toàn bộ RLS) và chỉ nhận diện
-- một người qua ADMIN_CHAT_ID. Mở bot cho người thứ hai theo mẫu đó thì ai nhắn
-- được bot là làm được mọi thứ. Từ nay:
--
--   1) Mỗi chat Telegram gắn với đúng một hồ sơ (bảng telegram_links).
--      Liên kết bằng MÃ DÙNG MỘT LẦN, hạn 10 phút, lấy trên Mô Hub. Không tự khai email.
--   2) Với mỗi tin nhắn, bot xin Supabase cấp một phiên đăng nhập thật của người đó
--      và gọi database bằng phiên ấy → RLS và các hàm can_*() tự áp dụng như trên web.
--   3) Nhật ký ghi "Tên (qua Thư kí)": bot gửi kèm header x-mo-kenh: thu-ki.
--
-- Service role chỉ còn dùng để: tra chat → người, dùng mã liên kết, xin phiên
-- đăng nhập, gửi báo cáo sáng về ADMIN_CHAT_ID.
-- =====================================================================

-- ---------- Liên kết chat Telegram ↔ hồ sơ ----------
create table public.telegram_links (
  chat_id    bigint primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  linked_at  timestamptz not null default now(),
  revoked_at timestamptz                      -- admin ngắt liên kết thì điền, không xóa dòng
);
create index on public.telegram_links (profile_id);
alter table public.telegram_links enable row level security;   -- không policy: client không đụng được
revoke all on public.telegram_links from anon, authenticated;

-- ---------- Mã liên kết dùng một lần ----------
-- Chỉ lưu mã đã băm (sha256), không lưu mã gốc.
create table public.telegram_link_codes (
  code_hash    text primary key,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by_chat bigint
);
alter table public.telegram_link_codes enable row level security;   -- không policy
revoke all on public.telegram_link_codes from anon, authenticated;

-- ---------- Thao tác có đi qua Thư kí không ----------
-- PostgREST đưa header của request vào biến request.headers (tên header viết thường).
-- Header này chỉ đổi NHÃN trong nhật ký, không cấp thêm quyền gì.
create or replace function public.qua_thu_ki() returns boolean
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-mo-kenh', '') = 'thu-ki'
$$;

-- Nhãn người thao tác: "Duy" trên web, "Duy (qua Thư kí)" qua Telegram.
-- Không có người đăng nhập (lịch tự động, SQL Editor) → "Hệ thống".
create or replace function public.actor_label() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(full_name, email) || case when qua_thu_ki() then ' (qua Thư kí)' else '' end
       from profiles where id = auth.uid()),
    'Hệ thống')
$$;

-- ---------- Người dùng lấy mã liên kết (nút "Kết nối Telegram" trên Mô Hub) ----------
create or replace function public.tao_ma_lien_ket_telegram() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_chu  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- bỏ 0/O/1/I cho khỏi đọc nhầm
  v_byte bytea := uuid_send(gen_random_uuid());
  v_ma   text := '';
  v_i    int;
begin
  if not can_read() then
    raise exception 'Chỉ thành viên đã được duyệt mới kết nối Telegram được';
  end if;
  -- 8 ký tự từ 8 byte ngẫu nhiên của uuid v4 (bỏ byte 6 và 8 vì chứa bit phiên bản)
  foreach v_i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    v_ma := v_ma || substr(v_chu, get_byte(v_byte, v_i) % 32 + 1, 1);
  end loop;

  delete from telegram_link_codes where profile_id = auth.uid() and used_at is null;   -- mã cũ hết hiệu lực
  delete from telegram_link_codes where expires_at < now() - interval '1 day';          -- dọn rác
  insert into telegram_link_codes (code_hash, profile_id, expires_at)
  values (encode(sha256(convert_to(v_ma, 'UTF8')), 'hex'), auth.uid(), now() + interval '10 minutes');
  return v_ma;
end $$;

-- ---------- Bot dùng mã (chỉ máy chủ) ----------
-- Trả {ok:true, ten} hoặc {ok:false, ly_do: khong_dung | da_dung | het_han | chua_duyet}
create or replace function public.bot_dung_ma_lien_ket(p_chat bigint, p_ma text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  c        public.telegram_link_codes%rowtype;
  v_ten    text;
  v_status public.user_status;
begin
  if not la_may_chu() then
    raise exception 'Chỉ Thư kí trên máy chủ mới dùng được mã liên kết';
  end if;

  select * into c from telegram_link_codes
   where code_hash = encode(sha256(convert_to(upper(btrim(coalesce(p_ma, ''))), 'UTF8')), 'hex')
   for update;
  if not found           then return jsonb_build_object('ok', false, 'ly_do', 'khong_dung'); end if;
  if c.used_at is not null then return jsonb_build_object('ok', false, 'ly_do', 'da_dung');    end if;
  if c.expires_at <= now()  then return jsonb_build_object('ok', false, 'ly_do', 'het_han');    end if;

  select coalesce(full_name, email), status into v_ten, v_status from profiles where id = c.profile_id;
  if v_status is distinct from 'approved' then
    return jsonb_build_object('ok', false, 'ly_do', 'chua_duyet');
  end if;

  update telegram_link_codes set used_at = now(), used_by_chat = p_chat where code_hash = c.code_hash;
  insert into telegram_links (chat_id, profile_id) values (p_chat, c.profile_id)
  on conflict (chat_id) do update
    set profile_id = excluded.profile_id, linked_at = now(), revoked_at = null;
  return jsonb_build_object('ok', true, 'ten', v_ten);
end $$;

-- ---------- Bot tra chat → người (chỉ máy chủ) ----------
-- Không trả gì nếu chưa liên kết, đã bị ngắt, hoặc hồ sơ không còn ở trạng thái đã duyệt.
create or replace function public.bot_nguoi_cua_chat(p_chat bigint)
returns table (profile_id uuid, email text, ten text, vai_tro public.user_role)
language plpgsql stable security definer set search_path = public as $$
begin
  if not la_may_chu() then
    raise exception 'Chỉ Thư kí trên máy chủ mới tra được liên kết';
  end if;
  return query
    select p.id, p.email, coalesce(p.full_name, p.email), p.role
      from telegram_links l
      join profiles p on p.id = l.profile_id
     where l.chat_id = p_chat and l.revoked_at is null and p.status = 'approved';
end $$;

-- ---------- Người dùng xem mình đã kết nối chưa ----------
create or replace function public.lien_ket_telegram_cua_toi() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_read() then raise exception 'Chưa đăng nhập hoặc chưa được duyệt'; end if;
  return (select count(*) from telegram_links where profile_id = auth.uid() and revoked_at is null);
end $$;

-- ---------- Admin quản lý liên kết ----------
create or replace function public.ds_lien_ket_telegram()
returns table (chat_id bigint, profile_id uuid, linked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Chỉ quản trị viên xem được danh sách liên kết Telegram'; end if;
  return query
    select l.chat_id, l.profile_id, l.linked_at from telegram_links l
     where l.revoked_at is null order by l.linked_at;
end $$;

create or replace function public.thu_hoi_lien_ket_telegram(p_chat bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Chỉ quản trị viên ngắt được liên kết Telegram'; end if;
  update telegram_links set revoked_at = now() where chat_id = p_chat and revoked_at is null;
end $$;

-- ---------- Bản nháp của bot giờ thuộc về từng người ----------
-- Bot đọc/ghi nháp bằng phiên của người nhắn, nên mỗi người chỉ thấy nháp của mình.
alter table public.bot_drafts
  add column owner_id uuid references public.profiles(id) on delete cascade default auth.uid();
alter table public.bot_booking_drafts
  add column owner_id uuid references public.profiles(id) on delete cascade default auth.uid();

create policy "bot_drafts: của mình" on public.bot_drafts for all to authenticated
  using (owner_id = auth.uid() and can_edit()) with check (owner_id = auth.uid() and can_edit());
create policy "bot_booking_drafts: của mình" on public.bot_booking_drafts for all to authenticated
  using (owner_id = auth.uid() and can_book()) with check (owner_id = auth.uid() and can_book());
revoke all on public.bot_drafts, public.bot_booking_drafts from anon;

-- Dọn cả nháp việc lẫn nháp booking cũ hơn 1 ngày (gọi trong lượt báo cáo sáng)
create or replace function public.don_nhap_booking_cu() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not la_may_chu() then raise exception 'Hàm này chỉ chạy tự động trên máy chủ'; end if;
  delete from bot_booking_drafts where created_at < now() - interval '1 day';
  delete from bot_drafts         where created_at < now() - interval '1 day';
end $$;

-- ---------- Quyền gọi hàm (CLAUDE.md mục 9.3b) ----------
revoke all on function public.qua_thu_ki()                            from public, anon;
revoke all on function public.tao_ma_lien_ket_telegram()              from public, anon;
revoke all on function public.lien_ket_telegram_cua_toi()             from public, anon;
revoke all on function public.ds_lien_ket_telegram()                  from public, anon;
revoke all on function public.thu_hoi_lien_ket_telegram(bigint)       from public, anon;
revoke all on function public.bot_dung_ma_lien_ket(bigint, text)      from public, anon, authenticated;
revoke all on function public.bot_nguoi_cua_chat(bigint)              from public, anon, authenticated;
revoke all on function public.don_nhap_booking_cu()                   from public, anon, authenticated;

grant execute on function public.qua_thu_ki()                         to authenticated, service_role;
grant execute on function public.tao_ma_lien_ket_telegram()           to authenticated;
grant execute on function public.lien_ket_telegram_cua_toi()          to authenticated;
grant execute on function public.ds_lien_ket_telegram()               to authenticated;
grant execute on function public.thu_hoi_lien_ket_telegram(bigint)    to authenticated;
grant execute on function public.bot_dung_ma_lien_ket(bigint, text)   to service_role;
grant execute on function public.bot_nguoi_cua_chat(bigint)           to service_role;
grant execute on function public.don_nhap_booking_cu()                to service_role;
