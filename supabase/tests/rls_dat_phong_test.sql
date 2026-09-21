-- =====================================================================
-- KIỂM THỬ ĐẶT PHÒNG (migration 20260921000003)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA.
-- Chạy trong 1 transaction và ROLLBACK ở cuối, không để lại dữ liệu.
--
-- Nghiệm thu theo CLAUDE.md mục 7.4:
--   · không thể tạo 2 booking chồng ngày trên cùng đơn vị
--   · chủ đầu tư gọi API trực tiếp không lấy được SĐT/giấy tờ khách
--   · view công khai không lộ tên khách
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';

insert into auth.users (id, email) values
  ('e0000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('e0000000-0000-4000-8000-000000000002', 'test-quanly@mo.test'),
  ('e0000000-0000-4000-8000-000000000003', 'test-nhanvien@mo.test'),
  ('e0000000-0000-4000-8000-000000000004', 'test-chudautu@mo.test');

update profiles set full_name = 'Test Admin' where id = 'e0000000-0000-4000-8000-000000000001';
update profiles set status='approved', role='manager', full_name='Chị Quản lý'  where id = 'e0000000-0000-4000-8000-000000000002';
update profiles set status='approved', role='staff',   full_name='Anh Kỹ thuật' where id = 'e0000000-0000-4000-8000-000000000003';
update profiles set status='approved', role='viewer',  full_name='Chủ đầu tư'   where id = 'e0000000-0000-4000-8000-000000000004';

insert into properties (id, code, name, is_published) values
  ('f0000000-0000-4000-8000-00000000000a', 'TESTP', 'Nhà test P2', true);
insert into units (id, property_id, code, name, is_published) values
  ('f0000000-0000-4000-8000-0000000000aa', 'f0000000-0000-4000-8000-00000000000a', 'U1', 'Căn test 1', true),
  ('f0000000-0000-4000-8000-0000000000bb', 'f0000000-0000-4000-8000-00000000000a', 'U2', 'Căn test 2', true);

-- =====================================================================
-- QUẢN LÝ — đặt phòng được, nhưng không thể đặt chồng lịch
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare v_khach uuid; v_bk bigint; ok boolean; n int;
begin
  insert into guests (full_name, phone, id_doc_no) values ('Khách Test', '0900000000', 'CCCD-TEST')
    returning id into v_khach;

  insert into bookings (unit_id, guest_id, start_date, end_date, term_type, rent_amount, status)
    values ('f0000000-0000-4000-8000-0000000000aa', v_khach, '2026-10-01', '2027-01-01', 'dai_han', 20000000, 'da_coc')
    returning id into v_bk;

  if (select created_by from bookings where id = v_bk) is distinct from 'Chị Quản lý' then
    raise exception 'FAIL 1a: created_by không phải người tạo'; end if;

  -- Chồng lịch hoàn toàn
  ok := false;
  begin
    insert into bookings (unit_id, start_date, end_date)
      values ('f0000000-0000-4000-8000-0000000000aa', '2026-10-05', '2026-11-05');
  exception when exclusion_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL 1b: đặt được 2 khách chồng ngày trên cùng căn'; end if;

  -- Chồng một phần (bắt đầu trước, kết thúc giữa kỳ)
  ok := false;
  begin
    insert into bookings (unit_id, start_date, end_date)
      values ('f0000000-0000-4000-8000-0000000000aa', '2026-09-20', '2026-10-02');
  exception when exclusion_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL 1c: đặt chồng một phần vẫn lọt'; end if;

  -- Nối tiếp đúng ngày trả phòng thì PHẢI được (khoảng [vào, ra))
  insert into bookings (unit_id, start_date, end_date)
    values ('f0000000-0000-4000-8000-0000000000aa', '2027-01-01', '2027-02-01');

  -- Cùng ngày nhưng khác căn thì được
  insert into bookings (unit_id, start_date, end_date)
    values ('f0000000-0000-4000-8000-0000000000bb', '2026-10-01', '2026-11-01');

  -- Booking đã hủy không chiếm chỗ nữa
  update bookings set status = 'huy' where unit_id = 'f0000000-0000-4000-8000-0000000000bb';
  insert into bookings (unit_id, start_date, end_date)
    values ('f0000000-0000-4000-8000-0000000000bb', '2026-10-10', '2026-10-20');

  -- Ngày trả phòng phải sau ngày vào
  ok := false;
  begin
    insert into bookings (unit_id, start_date, end_date)
      values ('f0000000-0000-4000-8000-0000000000bb', '2026-12-01', '2026-12-01');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL 1d: nhận booking có ngày ra không sau ngày vào'; end if;

  -- Lịch thu tiền theo tháng: 01/10/2026 → 01/01/2027 = 3 kỳ
  n := generate_rent_schedule(v_bk);
  if n <> 3 then raise exception 'FAIL 1e: lịch thu tiền tạo % kỳ, đáng lẽ 3', n; end if;
  if (select string_agg(period_label, ', ' order by due_date) from payments where booking_id = v_bk)
     is distinct from 'T10/2026, T11/2026, T12/2026' then
    raise exception 'FAIL 1f: nhãn kỳ thu tiền sai (%)',
      (select string_agg(period_label, ', ' order by due_date) from payments where booking_id = v_bk); end if;
  if (select sum(amount_due) from payments where booking_id = v_bk) <> 60000000 then
    raise exception 'FAIL 1g: tổng tiền thuê phải là 3 tháng × giá tháng'; end if;

  -- Chạy lại không nhân đôi
  perform generate_rent_schedule(v_bk);
  if (select count(*) from payments where booking_id = v_bk and kind = 'tien_thue') <> 3 then
    raise exception 'FAIL 1h: chạy lại lịch thu tiền bị nhân đôi'; end if;

  -- Quản lý không được xóa mềm
  ok := false;
  begin
    update bookings set deleted_at = now() where id = v_bk;
  exception when raise_exception then ok := true;
  end;
  if not ok then raise exception 'FAIL 1i: quản lý xóa mềm được booking'; end if;

  -- Nhật ký booking có dòng tạo
  if not exists (select 1 from booking_log where booking_id = v_bk and action = 'tao' and actor = 'Chị Quản lý') then
    raise exception 'FAIL 1j: nhật ký booking không ghi người tạo'; end if;
end $$;

-- =====================================================================
-- NHÂN VIÊN — không dính dáng gì tới đặt phòng
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$
declare ok boolean := false;
begin
  if (select count(*) from bookings) <> 0 then
    raise exception 'FAIL 2a: nhân viên xem được booking'; end if;
  if (select count(*) from guests) <> 0 then
    raise exception 'FAIL 2b: nhân viên xem được dữ liệu khách'; end if;
  if (select count(*) from bookings_viewer) <> 0 then
    raise exception 'FAIL 2c: nhân viên xem được lịch qua view'; end if;
  begin
    insert into bookings (unit_id, start_date, end_date)
      values ('f0000000-0000-4000-8000-0000000000aa', '2027-06-01', '2027-07-01');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 2d: nhân viên tạo được booking'; end if;
  -- nhưng vẫn xem được danh sách đơn vị của nhà mình để giao việc
  if (select count(*) from units) <> 2 then
    raise exception 'FAIL 2e: nhân viên không xem được danh sách căn'; end if;
end $$;

-- =====================================================================
-- CHỦ ĐẦU TƯ — xem lịch và tiền, KHÔNG thấy dữ liệu cá nhân khách
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);

do $$
declare ok boolean := false;
begin
  if (select count(*) from bookings_viewer) < 3 then
    raise exception 'FAIL 3a: chủ đầu tư không xem được lịch thuê'; end if;
  if (select guest_name from bookings_viewer where guest_name is not null limit 1) is distinct from 'Khách Test' then
    raise exception 'FAIL 3b: view chủ đầu tư thiếu tên khách'; end if;
  if (select count(*) from guests) <> 0 then
    raise exception 'FAIL 3c: chủ đầu tư đọc được bảng khách (SĐT, giấy tờ)'; end if;
  if (select count(*) from bookings) <> 0 then
    raise exception 'FAIL 3d: chủ đầu tư đọc được bảng bookings gốc'; end if;
  if (select count(*) from payments) = 0 then
    raise exception 'FAIL 3e: chủ đầu tư không xem được lịch thu tiền'; end if;
  begin
    insert into bookings (unit_id, start_date, end_date)
      values ('f0000000-0000-4000-8000-0000000000aa', '2027-08-01', '2027-09-01');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL 3f: chủ đầu tư tạo được booking'; end if;
end $$;

-- =====================================================================
-- KHÁCH VÃNG LAI — view công khai chỉ có ngày bận, không có tên khách
-- =====================================================================
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare ok boolean := false;
begin
  if (select count(*) from public_units) <> 2 then
    raise exception 'FAIL 4a: view công khai không trả đúng số căn đã xuất bản'; end if;
  if (select count(*) from public_availability) = 0 then
    raise exception 'FAIL 4b: view lịch trống công khai rỗng'; end if;
  begin
    if (select count(*) from guests) <> 0 then
      raise exception 'FAIL 4c: anon đọc được bảng khách'; end if;
    if (select count(*) from bookings) <> 0 then
      raise exception 'FAIL 4d: anon đọc được bảng bookings'; end if;
  exception when insufficient_privilege then null;
  end;
  -- View chủ đầu tư: anon hoặc bị từ chối quyền, hoặc nhận về rỗng — cả hai đều đạt
  begin
    if (select count(*) from bookings_viewer) <> 0 then
      raise exception 'FAIL 4e: anon đọc được dữ liệu trong view chủ đầu tư'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- =====================================================================
-- ADMIN — xóa mềm được, và tự chuyển trạng thái theo ngày chạy đúng
-- =====================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare v_bk bigint;
begin
  select id into v_bk from bookings where unit_id = 'f0000000-0000-4000-8000-0000000000aa' order by id limit 1;
  update bookings set deleted_at = now() where id = v_bk;
  if not exists (select 1 from booking_log where booking_id = v_bk and action = 'xoa' and actor = 'Test Admin') then
    raise exception 'FAIL 5a: nhật ký không ghi lần xóa của admin'; end if;
  update bookings set deleted_at = null where id = v_bk;

  -- Booking quá khứ phải tự chuyển sang kết thúc
  insert into bookings (unit_id, start_date, end_date, status)
    values ('f0000000-0000-4000-8000-0000000000bb', '2020-01-01', '2020-02-01', 'da_coc');
  perform cap_nhat_trang_thai_booking();
  if exists (select 1 from bookings where start_date = '2020-01-01' and status <> 'ket_thuc') then
    raise exception 'FAIL 5b: booking đã qua không tự chuyển sang kết thúc'; end if;
end $$;

reset role;
select 'Kiểm thử đặt phòng đã qua' as ket_qua;
rollback;
