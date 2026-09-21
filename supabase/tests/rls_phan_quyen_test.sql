-- =====================================================================
-- KIỂM THỬ PHÂN QUYỀN CHI TIẾT (migration 20260921000002)
-- Cách chạy: dán toàn bộ vào Supabase > SQL Editor > Run.
-- Không lỗi đỏ = QUA. Chạy trong 1 transaction và ROLLBACK ở cuối, không để lại dữ liệu.
--
-- Tình huống: anh Tâm (kỹ thuật) chỉ phụ trách Nhà A.
--   → thấy việc của Nhà A, thấy việc được gán đích danh ở Nhà B,
--     KHÔNG thấy việc khác của Nhà B, KHÔNG thấy Nhà B trong danh sách nhà.
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';

insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('c0000000-0000-4000-8000-000000000002', 'test-tam@mo.test'),
  ('c0000000-0000-4000-8000-000000000003', 'test-quanly@mo.test');

update profiles set full_name = 'Test Admin' where id = 'c0000000-0000-4000-8000-000000000001';
update profiles set status = 'approved', role = 'staff', full_name = 'Anh Tâm',
       restrict_properties = true, can_see_share_links = false
  where id = 'c0000000-0000-4000-8000-000000000002';
update profiles set status = 'approved', role = 'manager', full_name = 'Chị Quản lý'
  where id = 'c0000000-0000-4000-8000-000000000003';

insert into properties (id, code, name) values
  ('d0000000-0000-4000-8000-00000000000a', 'TESTA', 'Nhà A test'),
  ('d0000000-0000-4000-8000-00000000000b', 'TESTB', 'Nhà B test');

-- Anh Tâm chỉ phụ trách Nhà A
insert into user_properties (user_id, property_id)
  values ('c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000a');

insert into share_links (grp, title, url) values ('Test', 'Link test', 'https://example.com');

insert into tasks (property_id, title, assignee_id) values
  ('d0000000-0000-4000-8000-00000000000a', 'Việc nhà A',                 null),
  ('d0000000-0000-4000-8000-00000000000b', 'Việc nhà B',                 null),
  ('d0000000-0000-4000-8000-00000000000b', 'Việc nhà B gán cho anh Tâm', 'c0000000-0000-4000-8000-000000000002'),
  (null,                                   'Việc chung',                 null);

-- =====================================================================
-- ANH TÂM — bị giới hạn theo nhà
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare n int; ok boolean;
begin
  -- Nhà: chỉ thấy Nhà A
  if (select count(*) from properties where code in ('TESTA','TESTB')) <> 1
     or (select count(*) from properties where code = 'TESTA') <> 1 then
    raise exception 'FAIL 1a: người bị giới hạn vẫn thấy nhà không thuộc phạm vi'; end if;

  -- Việc: thấy việc nhà A + việc được gán đích danh; không thấy việc nhà B khác, không thấy việc chung
  if (select string_agg(title, ', ' order by title) from tasks)
     is distinct from 'Việc nhà A, Việc nhà B gán cho anh Tâm' then
    raise exception 'FAIL 1b: danh sách việc nhìn thấy không đúng (%)',
      (select string_agg(title, ', ' order by title) from tasks); end if;

  -- Không sửa được việc không thấy
  update tasks set priority = 'cao' where title = 'Việc nhà B';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 1c: sửa được việc của nhà không phụ trách'; end if;

  -- Sửa được việc của nhà mình
  update tasks set priority = 'cao' where title = 'Việc nhà A';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 1d: không sửa được việc của nhà mình'; end if;

  -- Không tạo được việc cho nhà không phụ trách
  ok := false;
  begin
    insert into tasks (property_id, title) values ('d0000000-0000-4000-8000-00000000000b', 'Việc lén');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 1e: tạo được việc cho nhà không phụ trách'; end if;

  -- Không đẩy việc của mình sang nhà khác
  ok := false;
  begin
    update tasks set property_id = 'd0000000-0000-4000-8000-00000000000b' where title = 'Việc nhà A';
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 1f: chuyển được việc sang nhà không phụ trách'; end if;

  -- Nhật ký: chỉ thấy nhật ký của việc mình thấy
  if exists (select 1 from task_log where changes->>'title' = 'Việc nhà B') then
    raise exception 'FAIL 1g: thấy nhật ký của việc không được phép xem'; end if;
  if not exists (select 1 from task_log where changes->>'title' = 'Việc nhà A') then
    raise exception 'FAIL 1g2: không thấy nhật ký của việc mình được phép xem'; end if;

  -- Kho link: đã tắt cho người này
  if (select count(*) from share_links where title = 'Link test') <> 0 then
    raise exception 'FAIL 1h: tắt kho link rồi mà vẫn xem được'; end if;

  -- Tự bật cờ cho mình thì không được
  update profiles set restrict_properties = false, can_see_share_links = true where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 1i: tự gỡ được giới hạn của chính mình'; end if;

  -- Tự gán thêm nhà cho mình thì không được
  ok := false;
  begin
    insert into user_properties (user_id, property_id)
      values (auth.uid(), 'd0000000-0000-4000-8000-00000000000b');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 1j: tự gán thêm nhà cho mình'; end if;
end $$;

-- =====================================================================
-- QUẢN LÝ — không bật giới hạn → thấy hết như cũ
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$ begin
  if (select count(*) from properties where code in ('TESTA','TESTB')) <> 2 then
    raise exception 'FAIL 2a: người không bị giới hạn lại không thấy đủ nhà'; end if;
  if (select count(*) from tasks where title like 'Việc%') <> 4 then
    raise exception 'FAIL 2b: người không bị giới hạn lại không thấy đủ việc'; end if;
  if (select count(*) from share_links where title = 'Link test') <> 1 then
    raise exception 'FAIL 2c: kho link đang bật mà không xem được'; end if;
end $$;

-- =====================================================================
-- ADMIN — thấy hết, và là người duy nhất đổi được phân quyền
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare n int;
begin
  if (select count(*) from tasks where title like 'Việc%') <> 4 then
    raise exception 'FAIL 3a: admin không thấy đủ việc'; end if;
  update profiles set restrict_properties = false where id = 'c0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 3b: admin không tắt được giới hạn của người khác'; end if;
  insert into user_properties (user_id, property_id)
    values ('c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000b');
  delete from user_properties
    where user_id = 'c0000000-0000-4000-8000-000000000002'
      and property_id = 'd0000000-0000-4000-8000-00000000000b';
end $$;

-- Gỡ giới hạn xong thì anh Tâm thấy lại đầy đủ
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$ begin
  if (select count(*) from tasks where title like 'Việc%') <> 4 then
    raise exception 'FAIL 4a: gỡ giới hạn rồi mà vẫn không thấy đủ việc'; end if;
end $$;

reset role;
select 'Kiểm thử phân quyền chi tiết đã qua' as ket_qua;
rollback;
