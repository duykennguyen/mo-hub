-- =====================================================================
-- BOT CONTENT (Mô House · Mô Bedding) — GIAI ĐOẠN A: DỮ LIỆU
-- Spec: SPEC-bot-content-Mo.md v1.0 (25/09/2026)
--
-- content_topics   : hàng đợi chủ đề (Duy nạp qua bot hoặc web; hàng đợi trống thì KHÔNG tự bịa)
-- content_slots    : mỗi khung giờ (ngày × thương hiệu) sinh đúng MỘT bài — unique(slot_date, brand)
-- content_posts    : mỗi bài một dòng; khóa claimed_by/claimed_at tránh hai bộ máy viết trùng
-- content_versions : lịch sử phiên bản của từng bài
--
-- Quyền: admin toàn quyền · manager chỉ đọc · staff/viewer/anon không truy cập.
-- Runner trên máy Duy và bộ máy dự phòng KHÔNG giữ khóa database: đi qua Edge Function
-- content-api (giai đoạn C/D) — hàm đó chỉ gọi các hàm SQL giới hạn trong 4 bảng này.
-- Bài viết là nháp (L1 theo Blueprint): không có gì tự đăng ra mạng xã hội.
-- =====================================================================

-- ---------- Ai được xem kho content ----------
create or replace function public.can_view_content() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'manager'), false)
$$;

-- ---------- Nhãn tác nhân: người qua kênh nào, hoặc agent nào ----------
-- Kênh gọi = header x-mo-kenh do bot gửi kèm (chỉ đổi NHÃN, không cấp quyền gì).
create or replace function public.kenh_goi() returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-mo-kenh', '')
$$;

-- Giữ hàm cũ cho tương thích (test và code Thư kí đang dùng)
create or replace function public.qua_thu_ki() returns boolean
language sql stable set search_path = public as $$
  select kenh_goi() = 'thu-ki'
$$;

-- "Duy (qua Thư kí)", "Duy (qua Content House)"… cho người đăng nhập.
-- Agent chạy quyền máy chủ (content-api, dự phòng) tự khai tên bằng biến phiên mo.tac_nhan,
-- ví dụ "Content House (Claude)". Chỉ máy chủ khai được → người dùng web không giả danh agent.
create or replace function public.actor_label() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(full_name, email) || case kenh_goi()
              when 'thu-ki'          then ' (qua Thư kí)'
              when 'content-house'   then ' (qua Content House)'
              when 'content-bedding' then ' (qua Content Bedding)'
              else '' end
       from profiles where id = auth.uid()),
    case when la_may_chu() then nullif(btrim(current_setting('mo.tac_nhan', true)), '') end,
    'Hệ thống')
$$;

-- ---------- Bảng ----------
create table public.content_topics (
  id          bigint generated always as identity primary key,
  brand       text not null check (brand in ('house', 'bedding')),
  topic       text not null check (btrim(topic) <> ''),
  format      text,                          -- "caption IG", "mô tả listing"…; trống = mặc định trong skill
  notes       text,
  priority    int  not null default 0,       -- lớn hơn viết trước
  status      text not null default 'cho' check (status in ('cho', 'da_dung', 'huy')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.content_topics (brand, status, priority desc, created_at);

create table public.content_posts (
  id                  bigint generated always as identity primary key,
  brand               text not null check (brand in ('house', 'bedding')),
  topic_id            bigint references public.content_topics(id),
  -- cho_viet: yêu cầu /vietngay chờ bộ máy nhận · dang_viet: đã giành khóa, đang viết
  status              text not null default 'cho_viet'
                        check (status in ('cho_viet', 'dang_viet', 'cho_duyet', 'can_viet_lai', 'da_duyet', 'da_dang', 'huy')),
  current_version     int  not null default 0,
  feedback_pending    text,                  -- yêu cầu sửa của Duy, dùng cho lần viết lại kế tiếp
  engine              text check (engine in ('claude', 'du_phong')),
  claimed_by          text,                  -- 'may-duy' | 'du-phong'
  claimed_at          timestamptz,
  telegram_message_id bigint,
  approved_at         timestamptz,
  published_url       text check (published_url is null or published_url ~ '^https?://'),
  published_at        timestamptz,
  created_by          text,
  updated_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index on public.content_posts (brand, status) where deleted_at is null;

create table public.content_slots (
  slot_date  date not null,
  brand      text not null check (brand in ('house', 'bedding')),
  post_id    bigint not null references public.content_posts(id),
  created_at timestamptz not null default now(),
  primary key (slot_date, brand)             -- mỗi khung giờ đúng một bài, dù máy Duy hay dự phòng viết
);

create table public.content_versions (
  id              bigint generated always as identity primary key,
  post_id         bigint not null references public.content_posts(id) on delete cascade,
  version_no      int  not null check (version_no >= 1),
  body            text not null check (btrim(body) <> ''),   -- markdown
  feedback_before text,                      -- yêu cầu sửa dẫn tới phiên bản này
  engine          text not null check (engine in ('claude', 'du_phong')),
  created_by      text,
  created_at      timestamptz not null default now(),
  unique (post_id, version_no)
);

-- ---------- Trigger: người tạo / người sửa / chỉ admin xóa mềm ----------
create or replace function public.content_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor_label());
  end if;
  if tg_table_name in ('content_topics', 'content_posts') then
    new.updated_at := now();
  end if;
  if tg_table_name = 'content_posts' then
    new.updated_by := actor_label();
    if tg_op = 'UPDATE' and new.deleted_at is distinct from old.deleted_at
       and not (la_may_chu() or is_admin()) then
      raise exception 'Chỉ quản trị viên được xóa hoặc khôi phục bài';
    end if;
  end if;
  return new;
end $$;
create trigger content_topics_guard   before insert or update on public.content_topics   for each row execute function public.content_guard();
create trigger content_posts_guard    before insert or update on public.content_posts    for each row execute function public.content_guard();
create trigger content_versions_guard before insert            on public.content_versions for each row execute function public.content_guard();

-- ---------- RLS ----------
alter table public.content_topics   enable row level security;
alter table public.content_posts    enable row level security;
alter table public.content_slots    enable row level security;
alter table public.content_versions enable row level security;

create policy "content_topics: xem"   on public.content_topics   for select using (can_view_content());
create policy "content_topics: ghi"   on public.content_topics   for all    using (is_admin()) with check (is_admin());
create policy "content_posts: xem"    on public.content_posts    for select using (can_view_content() and (deleted_at is null or is_admin()));
create policy "content_posts: ghi"    on public.content_posts    for all    using (is_admin()) with check (is_admin());
create policy "content_slots: xem"    on public.content_slots    for select using (can_view_content());
create policy "content_slots: ghi"    on public.content_slots    for all    using (is_admin()) with check (is_admin());
create policy "content_versions: xem" on public.content_versions for select using (can_view_content());
create policy "content_versions: ghi" on public.content_versions for all    using (is_admin()) with check (is_admin());

revoke all on public.content_topics, public.content_posts, public.content_slots, public.content_versions from anon;

-- ---------- Quyền gọi hàm (CLAUDE.md mục 9.3b) ----------
revoke all on function public.can_view_content() from public, anon;
revoke all on function public.kenh_goi()         from public, anon;
revoke all on function public.qua_thu_ki()       from public, anon;
grant execute on function public.can_view_content() to authenticated, service_role;
grant execute on function public.kenh_goi()         to authenticated, service_role;
grant execute on function public.qua_thu_ki()       to authenticated, service_role;
