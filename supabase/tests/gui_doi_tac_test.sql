-- =====================================================================
-- KIỂM THỬ TRANG GỬI ĐỐI TÁC (migration 20261022000001)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA. Tự hoàn tác.
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';
insert into auth.users (id, email) values
  ('dd000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('dd000000-0000-4000-8000-000000000002', 'test-nv@mo.test');
update profiles set status = 'approved', role = 'manager' where id = 'dd000000-0000-4000-8000-000000000002';

-- Dữ liệu giả: 1 nhà, 2 căn (1 căn ẩn)
insert into properties (id, code, name) values ('dd000000-0000-4000-8000-0000000000a1', 'TDT', 'Nhà test đối tác');
insert into units (id, property_id, code, name) values
  ('dd000000-0000-4000-8000-0000000000b1', 'dd000000-0000-4000-8000-0000000000a1', 'U1', 'Căn hiện'),
  ('dd000000-0000-4000-8000-0000000000b2', 'dd000000-0000-4000-8000-0000000000a1', 'U2', 'Căn ẩn');
insert into partner_houses (property_id, title) values ('dd000000-0000-4000-8000-0000000000a1', 'Test');
insert into partner_units (unit_id, title, link_anh) values
  ('dd000000-0000-4000-8000-0000000000b1', 'Căn hiện', 'https://drive.google.com/x');
insert into partner_units (unit_id, title, published) values
  ('dd000000-0000-4000-8000-0000000000b2', 'Căn ẩn', false);

-- 1. Khách chưa đăng nhập: đọc được view, chỉ thấy căn đang hiện; không đọc/ghi được bảng gốc
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare ok boolean;
begin
  if (select count(*) from public_partner_units where house_code = 'TDT') <> 1 then
    raise exception 'FAIL 1a: view phải trả đúng 1 căn đang hiện'; end if;
  if (select link_anh from public_partner_units where house_code = 'TDT') <> 'https://drive.google.com/x' then
    raise exception 'FAIL 1b: view không trả link'; end if;
  -- Bảng gốc: RLS trả 0 dòng (hoặc bị từ chối hẳn) — kiểu nào cũng không lộ dữ liệu
  ok := true;
  begin
    if exists (select 1 from partner_units) or exists (select 1 from partner_houses) then ok := false; end if;
  exception when insufficient_privilege then null; end;
  if not ok then raise exception 'FAIL 1c: anon đọc được bảng gốc'; end if;
  ok := false;
  begin insert into partner_houses (property_id, title) values ('dd000000-0000-4000-8000-0000000000a1', 'x');
  exception when insufficient_privilege or unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL 1d: anon ghi được bảng gốc'; end if;
end $$;
reset role;

-- 2. Quản lý (không phải admin): xem được bảng, sửa không có tác dụng
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
update partner_units set link_anh = 'https://evil.example/' where unit_id = 'dd000000-0000-4000-8000-0000000000b1';
reset role;
do $$ begin
  if (select link_anh from partner_units where unit_id = 'dd000000-0000-4000-8000-0000000000b1') <> 'https://drive.google.com/x' then
    raise exception 'FAIL 2: quản lý sửa được link'; end if;
end $$;

-- 3. Admin sửa được; link không phải https bị chặn
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
update partner_units set link_dai_han = 'https://drive.google.com/dh' where unit_id = 'dd000000-0000-4000-8000-0000000000b1';
do $$
declare ok boolean := false;
begin
  if (select link_dai_han from partner_units where unit_id = 'dd000000-0000-4000-8000-0000000000b1') <> 'https://drive.google.com/dh' then
    raise exception 'FAIL 3a: admin không sửa được link'; end if;
  begin update partner_units set link_anh = 'javascript:alert(1)' where unit_id = 'dd000000-0000-4000-8000-0000000000b1';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 3b: nhận link không phải https'; end if;
end $$;
reset role;

-- 4. Ẩn nhà thì cả nhà biến khỏi view
update partner_houses set published = false where property_id = 'dd000000-0000-4000-8000-0000000000a1';
do $$ begin
  if exists (select 1 from public_partner_units where house_code = 'TDT') then
    raise exception 'FAIL 4: nhà đã ẩn vẫn hiện'; end if;
end $$;

select 'gui_doi_tac_test: QUA' as ket_qua;
rollback;
