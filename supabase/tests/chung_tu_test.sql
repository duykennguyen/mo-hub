-- =====================================================================
-- KIỂM THỬ CHỨNG TỪ BOOKING (migration 20261007000001)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA.
-- Chạy trong 1 transaction và ROLLBACK ở cuối, không để lại dữ liệu.
--
--   · quản lý thêm / xem được ảnh giấy tờ của booking
--   · nhân viên, chủ đầu tư, khách vãng lai KHÔNG xem / thêm được (bảng lẫn kho ảnh)
--   · chỉ admin xóa được; kho ảnh là riêng tư
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';
insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('e1000000-0000-4000-8000-000000000002', 'test-quanly@mo.test'),
  ('e1000000-0000-4000-8000-000000000003', 'test-nhanvien@mo.test'),
  ('e1000000-0000-4000-8000-000000000004', 'test-chudautu@mo.test');
update profiles set status='approved', role='manager' where id = 'e1000000-0000-4000-8000-000000000002';
update profiles set status='approved', role='staff'   where id = 'e1000000-0000-4000-8000-000000000003';
update profiles set status='approved', role='viewer'  where id = 'e1000000-0000-4000-8000-000000000004';

insert into properties (id, code, name) values ('f1000000-0000-4000-8000-00000000000a', 'TESTCT', 'Nhà test chứng từ');
insert into units (id, property_id, code, name) values
  ('f1000000-0000-4000-8000-0000000000aa', 'f1000000-0000-4000-8000-00000000000a', 'U1', 'Căn test CT');
insert into bookings (id, unit_id, start_date, end_date) overriding system value values
  (990001, 'f1000000-0000-4000-8000-0000000000aa', '2026-11-01', '2026-11-05');

do $$ begin
  if (select public from storage.buckets where id = 'chung-tu-khach') is distinct from false then
    raise exception 'FAIL 0: kho chung-tu-khach phải là riêng tư'; end if;
end $$;

-- ---------- Quản lý: thêm + xem được ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ begin
  insert into storage.objects (bucket_id, name) values ('chung-tu-khach', '990001/a.jpg');
  insert into booking_files (booking_id, path, kind) values (990001, '990001/a.jpg', 'passport');
  if (select count(*) from booking_files where booking_id = 990001) <> 1 then
    raise exception 'FAIL 1a: quản lý không thấy ảnh vừa thêm'; end if;
  if (select count(*) from storage.objects where bucket_id = 'chung-tu-khach') <> 1 then
    raise exception 'FAIL 1b: quản lý không thấy file trong kho'; end if;
  -- Quản lý không xóa được
  delete from booking_files where booking_id = 990001;
  delete from storage.objects where bucket_id = 'chung-tu-khach';
end $$;
reset role;
do $$ begin
  if (select count(*) from booking_files where booking_id = 990001) <> 1
     or (select count(*) from storage.objects where bucket_id = 'chung-tu-khach') <> 1 then
    raise exception 'FAIL 1c: quản lý xóa được ảnh giấy tờ'; end if;
end $$;

-- ---------- Nhân viên và chủ đầu tư: không thấy, không thêm ----------
do $$
declare nguoi text; ok boolean;
begin
  foreach nguoi in array array['e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004'] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', nguoi), true);
    set local role authenticated;
    if (select count(*) from booking_files) <> 0 then raise exception 'FAIL 2a: % thấy bảng chứng từ', nguoi; end if;
    if (select count(*) from storage.objects where bucket_id = 'chung-tu-khach') <> 0 then
      raise exception 'FAIL 2b: % thấy file giấy tờ trong kho', nguoi; end if;
    ok := false;
    begin insert into booking_files (booking_id, path) values (990001, 'x-' || nguoi);
    exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception 'FAIL 2c: % thêm được chứng từ', nguoi; end if;
    ok := false;
    begin insert into storage.objects (bucket_id, name) values ('chung-tu-khach', 'x-' || nguoi);
    exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception 'FAIL 2d: % tải được file lên kho giấy tờ', nguoi; end if;
    reset role;
  end loop;
end $$;

-- ---------- Khách vãng lai ----------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ declare ok boolean := false; begin
  begin perform count(*) from booking_files; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 3a: anon đọc được bảng chứng từ'; end if;
  if (select count(*) from storage.objects where bucket_id = 'chung-tu-khach') <> 0 then
    raise exception 'FAIL 3b: anon thấy file giấy tờ'; end if;
end $$;
reset role;

-- ---------- Admin: xóa được ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  delete from booking_files where booking_id = 990001;
  delete from storage.objects where bucket_id = 'chung-tu-khach';
  if (select count(*) from booking_files where booking_id = 990001) <> 0 then
    raise exception 'FAIL 4: admin không xóa được chứng từ'; end if;
end $$;
reset role;

select 'chung_tu_test: QUA' as ket_qua;
rollback;
