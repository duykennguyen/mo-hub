-- =====================================================================
-- MÔ HUB — GIAI ĐOẠN 1: Người dùng · Nhà · Giao việc · Nhật ký · Kho link
-- Migration đầu tiên. Chạy bằng `npx supabase db push` hoặc dán vào SQL Editor (1 lần).
-- ĐÃ CHẠY TRÊN DỰ ÁN THẬT THÌ KHÔNG SỬA FILE NÀY — muốn đổi thì tạo migration mới.
-- =====================================================================

-- ---------- Kiểu dữ liệu ----------
create type public.user_role     as enum ('admin','manager','staff','viewer');
create type public.user_status   as enum ('pending','approved','rejected');
create type public.task_category as enum ('ky_thuat','buong_phong','quan_ly','khac');
create type public.task_priority as enum ('cao','thuong','thap');
create type public.task_status   as enum ('open','done');

-- ---------- Cấu hình (không client nào đọc được) ----------
create table public.app_settings (key text primary key, value text not null);
insert into public.app_settings values ('admin_email', 'duykennguyen@gmail.com');
alter table public.app_settings enable row level security;   -- không có policy = khóa hoàn toàn

-- ---------- Người dùng ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.user_role   not null default 'viewer',
  status      public.user_status not null default 'pending',
  notified_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Tự tạo hồ sơ khi có người đăng nhập lần đầu. Email admin được duyệt sẵn.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_admin text;
begin
  select value into v_admin from app_settings where key = 'admin_email';
  insert into profiles (id, email, role, status)
  values (new.id, lower(new.email),
          case when lower(new.email) = lower(v_admin) then 'admin'::user_role    else 'viewer'::user_role   end,
          case when lower(new.email) = lower(v_admin) then 'approved'::user_status else 'pending'::user_status end);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- Hàm phân quyền ----------
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'approved'
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = 'admin', false)
$$;
create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','manager','staff'), false)
$$;
create or replace function public.can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() is not null
$$;
-- Nhãn người thao tác, ghi vào nhật ký. Thao tác từ Thư kí (service role) không có auth.uid().
create or replace function public.actor_label() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(full_name, email) from profiles where id = auth.uid()), 'Thư kí (Telegram)')
$$;

-- Người dùng tự đặt tên hiển thị (chỉ tên, không đổi được quyền)
create or replace function public.set_my_name(p_name text) returns void
language sql security definer set search_path = public as $$
  update profiles set full_name = left(trim(p_name), 60) where id = auth.uid()
$$;

-- Danh sách tên thành viên đã duyệt (gợi ý ô "Người làm")
create or replace function public.list_team() returns table (name text)
language sql stable security definer set search_path = public as $$
  select coalesce(full_name, email) from profiles
  where status = 'approved' and can_read() order by 1
$$;

-- ---------- Nhà ----------
create table public.properties (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,              -- mã ngắn, ví dụ: SEN
  name        text not null,                     -- tên đầy đủ, ví dụ: Nhà Sen
  aliases     text[] not null default '{}',      -- từ khóa để Thư kí nhận ra nhà này
  address     text,
  rental_mode text,                              -- nguyên căn / chia phòng / ngắn hạn
  active      boolean not null default true,
  sort        int not null default 100,
  created_at  timestamptz not null default now()
);

-- ---------- Việc ----------
create table public.tasks (
  id          bigint generated always as identity primary key,
  property_id uuid references public.properties(id),
  title       text not null,
  detail      text,
  location    text,                              -- phòng/khu vực, ví dụ: P2
  category    public.task_category not null default 'khac',
  priority    public.task_priority not null default 'thuong',
  assignee    text,
  due_date    date,
  status      public.task_status not null default 'open',
  done_at     timestamptz,
  done_by     text,
  source      text not null default 'web',       -- web / telegram
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                        -- xóa mềm, chỉ admin
);
create index on public.tasks (status, deleted_at);

-- Tự điền người tạo, người hoàn thành; chặn người không phải admin xóa/khôi phục
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor_label());
  else
    if new.deleted_at is distinct from old.deleted_at
       and auth.uid() is not null and not is_admin() then
      raise exception 'Chỉ quản trị viên được xóa hoặc khôi phục việc';
    end if;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.done_at := now(); new.done_by := actor_label();
  elsif new.status = 'open' then
    new.done_at := null;  new.done_by := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger tasks_guard before insert or update on public.tasks
for each row execute function public.tasks_guard();

-- ---------- Nhật ký thay đổi ----------
create table public.task_log (
  id      bigint generated always as identity primary key,
  task_id bigint not null,
  action  text not null,        -- tao / sua / xong / mo_lai / xoa / khoi_phuc
  changes jsonb,
  actor   text,
  at      timestamptz not null default now()
);
create index on public.task_log (task_id, at desc);

create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_diff jsonb := '{}'; v_key text; v_act text;
begin
  if tg_op = 'INSERT' then
    insert into task_log (task_id, action, changes, actor)
    values (new.id, 'tao', jsonb_build_object('title', new.title), actor_label());
    return new;
  end if;
  for v_key in select jsonb_object_keys(to_jsonb(new)) loop
    if v_key not in ('updated_at','done_at','done_by')
       and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
      v_diff := v_diff || jsonb_build_object(v_key,
                jsonb_build_object('cu', to_jsonb(old) -> v_key, 'moi', to_jsonb(new) -> v_key));
    end if;
  end loop;
  if v_diff = '{}' then return new; end if;
  v_act := case
    when new.deleted_at is not null and old.deleted_at is null then 'xoa'
    when new.deleted_at is null and old.deleted_at is not null then 'khoi_phuc'
    when new.status = 'done' and old.status = 'open' then 'xong'
    when new.status = 'open' and old.status = 'done' then 'mo_lai'
    else 'sua' end;
  insert into task_log (task_id, action, changes, actor) values (new.id, v_act, v_diff, actor_label());
  return new;
end $$;
create trigger tasks_log after insert or update on public.tasks
for each row execute function public.log_task_change();

-- ---------- Kho link gửi khách ----------
create table public.share_links (
  id         bigint generated always as identity primary key,
  grp        text not null default 'Chung',   -- nhóm: Mô House / Mô Bedding / Pháp lý ...
  title      text not null,
  url        text not null,
  note       text,
  sort       int not null default 100,
  created_at timestamptz not null default now()
);

-- ---------- Nháp của Thư kí (chờ chọn nhà) ----------
create table public.bot_drafts (
  id         bigint generated always as identity primary key,
  text       text not null,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- PHÂN QUYỀN (RLS)
-- =====================================================================
alter table public.profiles    enable row level security;
alter table public.properties  enable row level security;
alter table public.tasks       enable row level security;
alter table public.task_log    enable row level security;
alter table public.share_links enable row level security;
alter table public.bot_drafts  enable row level security;   -- chỉ Thư kí (service role) dùng

-- Người dùng: tự xem hồ sơ mình; admin xem và sửa tất cả
create policy "profiles: xem"  on public.profiles for select using (id = auth.uid() or is_admin());
create policy "profiles: sửa"  on public.profiles for update using (is_admin()) with check (is_admin());

-- Nhà: thành viên đã duyệt xem; admin thêm/sửa
create policy "properties: xem" on public.properties for select using (can_read());
create policy "properties: ghi" on public.properties for all    using (is_admin()) with check (is_admin());

-- Việc: ai được duyệt (trừ "chỉ xem") đều thêm/sửa; việc đã xóa chỉ admin thấy; xóa cứng chỉ admin
create policy "tasks: xem"  on public.tasks for select using (can_read() and (deleted_at is null or is_admin()));
create policy "tasks: thêm" on public.tasks for insert with check (can_edit());
create policy "tasks: sửa"  on public.tasks for update using (can_edit() and (deleted_at is null or is_admin())) with check (can_edit());
create policy "tasks: xóa"  on public.tasks for delete using (is_admin());

-- Nhật ký: ai được duyệt cũng xem; không ai sửa/xóa được (chỉ trigger ghi)
create policy "task_log: xem" on public.task_log for select using (can_read());

-- Kho link: thành viên xem; admin quản lý
create policy "share_links: xem" on public.share_links for select using (can_read());
create policy "share_links: ghi" on public.share_links for all    using (is_admin()) with check (is_admin());

-- Dữ liệu nhà: xem supabase/seed.example.sql (không để dữ liệu thật trong migration).
