-- =====================================================================
-- KIỂM THỬ PHÂN QUYỀN — Giai đoạn 1 (ma trận quyền ở CLAUDE.md mục 5.2)
--
-- Cách chạy: dán TOÀN BỘ file vào Supabase > SQL Editor > Run
--   (hoặc: psql "<chuỗi kết nối>" -f supabase/tests/rls_test.sql)
-- Kết quả: không có lỗi đỏ = QUA. Có lỗi thì dòng "FAIL <số>: ..." cho biết quyền nào sai.
-- An toàn trên dự án thật: mọi thứ chạy trong 1 transaction và bị ROLLBACK ở cuối,
-- không để lại người dùng, nhà hay việc test nào.
--
-- Người dùng giả:   ...01 admin   ...02 quản lý   ...03 nhân viên
--                   ...04 chỉ xem ...05 chờ duyệt ...06 bị từ chối
-- =====================================================================
begin;

-- ---------- Chuẩn bị (quyền postgres) ----------
-- Đổi tạm email admin sang email test (rollback sẽ trả lại email thật)
update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('a0000000-0000-4000-8000-000000000002', 'test-manager@mo.test'),
  ('a0000000-0000-4000-8000-000000000003', 'test-staff@mo.test'),
  ('a0000000-0000-4000-8000-000000000004', 'test-viewer@mo.test'),
  ('a0000000-0000-4000-8000-000000000005', 'test-pending@mo.test'),
  ('a0000000-0000-4000-8000-000000000006', 'test-rejected@mo.test');

-- 1. Trigger tạo hồ sơ: admin tự duyệt, người khác chờ duyệt với vai trò "chỉ xem"
do $$ begin
  if (select count(*) from profiles where id = 'a0000000-0000-4000-8000-000000000001'
      and role = 'admin' and status = 'approved') <> 1 then
    raise exception 'FAIL 1a: email admin không được tự duyệt thành admin'; end if;
  if (select count(*) from profiles where email like 'test-%@mo.test'
      and email <> 'test-admin@mo.test' and role = 'viewer' and status = 'pending') <> 5 then
    raise exception 'FAIL 1b: người mới không ở trạng thái chờ duyệt / chỉ xem'; end if;
end $$;

-- Admin duyệt (giả lập ở tầng database)
update profiles set full_name = 'Test Admin' where id = 'a0000000-0000-4000-8000-000000000001';
update profiles set status = 'approved', role = 'manager', full_name = 'Test Quản lý' where id = 'a0000000-0000-4000-8000-000000000002';
update profiles set status = 'approved', role = 'staff',   full_name = 'Test Nhân viên' where id = 'a0000000-0000-4000-8000-000000000003';
update profiles set status = 'approved', role = 'viewer',  full_name = 'Test Chủ đầu tư' where id = 'a0000000-0000-4000-8000-000000000004';
update profiles set status = 'rejected' where id = 'a0000000-0000-4000-8000-000000000006';

insert into properties (id, code, name) values ('b0000000-0000-4000-8000-000000000001', 'TEST1', 'Nhà test');

-- =====================================================================
-- NHÂN VIÊN (staff)
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$
declare n int; ok boolean;
begin
  if (select count(*) from properties where code = 'TEST1') <> 1 then
    raise exception 'FAIL 2a: nhân viên không xem được danh sách nhà'; end if;

  -- Thêm việc → tự ghi người tạo + nhật ký "tao"
  insert into tasks (property_id, title) values ('b0000000-0000-4000-8000-000000000001', 'Việc test A');
  if (select created_by from tasks where title = 'Việc test A') is distinct from 'Test Nhân viên' then
    raise exception 'FAIL 2b: created_by không phải tên nhân viên'; end if;

  -- Sửa, Xong, Mở lại
  update tasks set detail = 'đã gọi thợ' where title = 'Việc test A';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 2c: nhân viên không sửa được việc'; end if;
  update tasks set status = 'done' where title = 'Việc test A';
  if (select done_by from tasks where title = 'Việc test A') is distinct from 'Test Nhân viên' then
    raise exception 'FAIL 2d: bấm Xong không ghi đúng người hoàn thành'; end if;
  update tasks set status = 'open' where title = 'Việc test A';
  if (select done_by from tasks where title = 'Việc test A') is not null then
    raise exception 'FAIL 2e: Mở lại không xóa người hoàn thành'; end if;

  -- Nhật ký đủ 4 bước, đúng tên người
  if (select string_agg(action, ',' order by id) from task_log
      where task_id = (select id from tasks where title = 'Việc test A') and actor = 'Test Nhân viên')
     is distinct from 'tao,sua,xong,mo_lai' then
    raise exception 'FAIL 2f: nhật ký thiếu bước hoặc sai tên người'; end if;

  -- Xóa mềm → database từ chối (nghiệm thu mục 7.2)
  ok := false;
  begin
    update tasks set deleted_at = now() where title = 'Việc test A';
  exception when raise_exception then ok := true;
  end;
  if not ok then raise exception 'FAIL 2g: nhân viên xóa mềm được việc'; end if;

  -- Xóa cứng → không dòng nào bị xóa
  delete from tasks where title = 'Việc test A';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2h: nhân viên xóa cứng được việc'; end if;

  -- Không tự ghi nhật ký
  ok := false;
  begin
    insert into task_log (task_id, action, actor) values (1, 'sua', 'giả mạo');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 2i: nhân viên tự ghi được nhật ký'; end if;
  update task_log set actor = 'giả mạo';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2j: nhân viên sửa được nhật ký'; end if;

  -- Không tự nâng quyền, chỉ thấy hồ sơ của mình
  update profiles set role = 'admin' where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2k: nhân viên tự đổi được vai trò'; end if;
  perform set_my_name('Test Nhân viên');   -- đổi tên thì được
  if (select count(*) from profiles) <> 1 then
    raise exception 'FAIL 2l: nhân viên thấy hồ sơ người khác'; end if;
  if (select count(*) from list_team()) < 4 then
    raise exception 'FAIL 2m: list_team() không trả danh sách thành viên'; end if;

  -- Kho link: xem được, không thêm được
  ok := false;
  begin
    insert into share_links (title, url) values ('x', 'https://x');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 2n: nhân viên thêm được link vào kho'; end if;

  -- app_settings khóa hoàn toàn
  begin
    if (select count(*) from app_settings) <> 0 then
      raise exception 'FAIL 2o: nhân viên đọc được app_settings'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- =====================================================================
-- QUẢN LÝ (manager): thêm/sửa được, không xóa được
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare ok boolean := false;
begin
  insert into tasks (title) values ('Việc test B');
  update tasks set priority = 'cao' where title = 'Việc test B';
  if (select priority from tasks where title = 'Việc test B') <> 'cao' then
    raise exception 'FAIL 3a: quản lý không sửa được việc'; end if;
  begin
    update tasks set deleted_at = now() where title = 'Việc test B';
  exception when raise_exception then ok := true;
  end;
  if not ok then raise exception 'FAIL 3b: quản lý xóa mềm được việc'; end if;
end $$;

-- =====================================================================
-- CHỈ XEM (viewer / chủ đầu tư): xem được, không thêm/sửa
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

do $$
declare n int; ok boolean := false;
begin
  if (select count(*) from tasks where title in ('Việc test A', 'Việc test B')) <> 2 then
    raise exception 'FAIL 4a: người chỉ xem không thấy việc'; end if;
  if (select count(*) from task_log where actor = 'Test Nhân viên') = 0 then
    raise exception 'FAIL 4b: người chỉ xem không thấy nhật ký'; end if;
  begin
    insert into tasks (title) values ('Việc của viewer');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 4c: người chỉ xem thêm được việc'; end if;
  update tasks set title = 'bị sửa' where title = 'Việc test A';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4d: người chỉ xem sửa được việc'; end if;
end $$;

-- =====================================================================
-- CHỜ DUYỆT & BỊ TỪ CHỐI: không thấy gì ngoài hồ sơ của mình
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);

do $$
declare ok boolean := false;
begin
  if (select count(*) from tasks) + (select count(*) from properties)
     + (select count(*) from task_log) + (select count(*) from share_links) <> 0 then
    raise exception 'FAIL 5a: người chờ duyệt thấy dữ liệu'; end if;
  if (select count(*) from profiles) <> 1 then
    raise exception 'FAIL 5b: người chờ duyệt không thấy (hoặc thấy quá) hồ sơ'; end if;
  begin
    insert into tasks (title) values ('Việc của người chờ duyệt');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 5c: người chờ duyệt thêm được việc'; end if;
  if (select count(*) from list_team()) <> 0 then
    raise exception 'FAIL 5d: người chờ duyệt xem được danh sách thành viên'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);

do $$ begin
  if (select count(*) from tasks) + (select count(*) from properties) + (select count(*) from task_log) <> 0 then
    raise exception 'FAIL 6a: người bị từ chối thấy dữ liệu'; end if;
end $$;

-- =====================================================================
-- ADMIN: xóa mềm, xem thùng rác, khôi phục, quản lý thành viên
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare n int;
begin
  update tasks set deleted_at = now() where title = 'Việc test A';
  if (select count(*) from tasks where title = 'Việc test A' and deleted_at is not null) <> 1 then
    raise exception 'FAIL 7a: admin không xóa mềm được / không thấy việc đã xóa'; end if;
  if (select count(*) from profiles where email like 'test-%@mo.test') <> 6 then
    raise exception 'FAIL 7b: admin không thấy đủ thành viên'; end if;
  update profiles set role = 'manager' where id = 'a0000000-0000-4000-8000-000000000004';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 7c: admin không đổi được vai trò'; end if;
  update profiles set role = 'viewer' where id = 'a0000000-0000-4000-8000-000000000004';
  insert into share_links (grp, title, url) values ('Test', 'Link test', 'https://example.com');
end $$;

-- Nhân viên không thấy việc đã xóa, không sửa được nó
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$
declare n int;
begin
  if (select count(*) from tasks where title = 'Việc test A') <> 0 then
    raise exception 'FAIL 8a: nhân viên thấy việc đã xóa'; end if;
  update tasks set title = 'sửa việc đã xóa' where title = 'Việc test A';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 8b: nhân viên sửa được việc đã xóa'; end if;
  if (select count(*) from share_links where title = 'Link test') <> 1 then
    raise exception 'FAIL 8c: nhân viên không xem được kho link'; end if;
end $$;

-- Admin khôi phục → nhật ký có "xoa" rồi "khoi_phuc" với tên admin
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$ begin
  update tasks set deleted_at = null where title = 'Việc test A';
  if (select string_agg(action, ',' order by id) from task_log
      where task_id = (select id from tasks where title = 'Việc test A') and actor = 'Test Admin')
     is distinct from 'xoa,khoi_phuc' then
    raise exception 'FAIL 9a: nhật ký xóa/khôi phục sai'; end if;
end $$;

-- =====================================================================
-- KHÁCH VÃNG LAI (anon): không đọc/ghi được bảng gốc
-- =====================================================================
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare ok boolean := false;
begin
  begin
    if (select count(*) from tasks) + (select count(*) from properties) + (select count(*) from profiles)
       + (select count(*) from task_log) + (select count(*) from share_links) <> 0 then
      raise exception 'FAIL 10a: anon đọc được bảng gốc'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into tasks (title) values ('Việc của anon');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 10b: anon thêm được việc'; end if;
end $$;

-- =====================================================================
-- MÁY CHỦ (service role, không có auth.uid()): được xóa, nhật ký ghi "Hệ thống".
-- Từ 26/09/2026 Thư kí không dùng service role để ghi nữa (xem thu_ki_theo_nguoi_test.sql).
-- =====================================================================
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$ begin
  update tasks set deleted_at = now() where title = 'Việc test B';
  if (select actor from task_log where task_id = (select id from tasks where title = 'Việc test B')
      and action = 'xoa') is distinct from 'Hệ thống' then
    raise exception 'FAIL 11a: thao tác của máy chủ ghi sai tên trong nhật ký'; end if;
end $$;

reset role;
select 'Tất cả kiểm thử phân quyền đã qua' as ket_qua;
rollback;
