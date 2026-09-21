-- =====================================================================
-- PHÂN QUYỀN CHI TIẾT THEO TỪNG NGƯỜI (quyết định của chủ dự án 21/09/2026)
--
-- 1) Giới hạn theo nhà: bật cờ cho một người → người đó chỉ thấy các nhà được
--    giao, và chỉ thấy việc của những nhà đó, CỘNG thêm việc gán đích danh họ.
-- 2) Bật/tắt từng mục trên Mô Hub: kho link gửi khách, trang cho khách, đặt phòng.
-- 3) Gán việc đích danh: thêm cột tasks.assignee_id (cột chữ assignee vẫn giữ để hiển thị).
--
-- Quản trị viên luôn thấy hết. Giao diện chỉ ẩn/hiện; chặn thật nằm ở RLS dưới đây.
-- =====================================================================

alter table public.profiles
  add column restrict_properties  boolean not null default false,  -- true = chỉ thấy nhà được giao
  add column can_see_share_links  boolean not null default true,
  add column can_see_public_sites boolean not null default true,
  add column can_see_booking      boolean not null default true;

-- Nhà được giao cho từng người
create table public.user_properties (
  user_id     uuid not null references public.profiles(id)   on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  primary key (user_id, property_id)
);
alter table public.user_properties enable row level security;
create policy "user_properties: xem" on public.user_properties for select
  using (user_id = auth.uid() or is_admin());
create policy "user_properties: ghi" on public.user_properties for all
  using (is_admin()) with check (is_admin());

alter table public.tasks add column assignee_id uuid references public.profiles(id);
create index on public.tasks (assignee_id);

-- ---------- Hàm hỗ trợ ----------
-- Người này có đang bị giới hạn theo nhà không? (admin thì không bao giờ)
create or replace function public.is_restricted() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select restrict_properties from profiles
                   where id = auth.uid() and status = 'approved'), false)
     and not is_admin()
$$;

create or replace function public.my_properties() returns setof uuid
language sql stable security definer set search_path = public as $$
  select property_id from user_properties where user_id = auth.uid()
$$;

-- Thấy được việc này không: không bị giới hạn, hoặc được gán đích danh, hoặc việc thuộc nhà mình phụ trách
create or replace function public.can_see_task(p_property uuid, p_assignee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not is_restricted()
      or p_assignee = auth.uid()
      or (p_property is not null and p_property in (select my_properties()))
$$;

-- Danh sách thành viên kèm id, để ô "Người làm" gán đích danh
create or replace function public.team_members() returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.full_name, p.email) from profiles p
  where p.status = 'approved' and can_read() order by 2
$$;

-- ---------- Cập nhật phân quyền ----------
drop policy "properties: xem" on public.properties;
create policy "properties: xem" on public.properties for select
  using (can_read() and (not is_restricted() or id in (select my_properties())));

drop policy "tasks: xem"  on public.tasks;
drop policy "tasks: thêm" on public.tasks;
drop policy "tasks: sửa"  on public.tasks;
create policy "tasks: xem" on public.tasks for select
  using (can_read() and (deleted_at is null or is_admin())
         and can_see_task(property_id, assignee_id));
create policy "tasks: thêm" on public.tasks for insert
  with check (can_edit() and can_see_task(property_id, assignee_id));
create policy "tasks: sửa" on public.tasks for update
  using (can_edit() and (deleted_at is null or is_admin())
         and can_see_task(property_id, assignee_id))
  with check (can_edit() and can_see_task(property_id, assignee_id));

-- Nhật ký: chỉ thấy nhật ký của việc mà mình thấy được (dựa luôn vào RLS của tasks)
drop policy "task_log: xem" on public.task_log;
create policy "task_log: xem" on public.task_log for select
  using (can_read() and (not is_restricted()
         or exists (select 1 from tasks t where t.id = task_log.task_id)));

-- Kho link gửi khách: admin luôn thấy; người khác theo cờ can_see_share_links
drop policy "share_links: xem" on public.share_links;
create policy "share_links: xem" on public.share_links for select
  using (can_read() and (is_admin()
         or coalesce((select p.can_see_share_links from profiles p where p.id = auth.uid()), true)));
