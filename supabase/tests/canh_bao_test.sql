-- =====================================================================
-- KIỂM THỬ CẢNH BÁO TỰ ĐỘNG (migration 20260922000008)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA.
-- Chạy trong 1 transaction và ROLLBACK ở cuối, không để lại dữ liệu.
--
-- Kiểm 5 điều:
--   1. Sinh đúng 3 loại cảnh báo: hợp đồng 30/15/7 ngày, thu quá hạn, cọc chưa hoàn
--   2. Chạy lần hai KHÔNG tạo việc trùng
--   3. Nhân viên và khách vãng lai gọi tao_canh_bao() đều bị từ chối
--   4. Chủ đầu tư (viewer) gọi bao_cao_ngay() KHÔNG nhận được số điện thoại khách
--   5. Quản lý thì vẫn nhận được số điện thoại (cần để liên hệ khách)
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';

insert into auth.users (id, email) values
  ('e0000000-0000-4000-8000-0000000000c1', 'test-admin@mo.test'),
  ('e0000000-0000-4000-8000-0000000000c2', 'test-quanly@mo.test'),
  ('e0000000-0000-4000-8000-0000000000c3', 'test-nhanvien@mo.test'),
  ('e0000000-0000-4000-8000-0000000000c4', 'test-chudautu@mo.test');

update profiles set status='approved', role='manager', full_name='Chị Quản lý'  where id = 'e0000000-0000-4000-8000-0000000000c2';
update profiles set status='approved', role='staff',   full_name='Anh Kỹ thuật' where id = 'e0000000-0000-4000-8000-0000000000c3';
update profiles set status='approved', role='viewer',  full_name='Chủ đầu tư'   where id = 'e0000000-0000-4000-8000-0000000000c4';

insert into properties (id, code, name) values
  ('f0000000-0000-4000-8000-0000000000c0', 'TESTCB', 'Nhà test cảnh báo');
insert into units (id, property_id, code, name) values
  ('f0000000-0000-4000-8000-0000000000ca', 'f0000000-0000-4000-8000-0000000000c0', 'U1', 'Căn cảnh báo 1'),
  ('f0000000-0000-4000-8000-0000000000cb', 'f0000000-0000-4000-8000-0000000000c0', 'U2', 'Căn cảnh báo 2');

-- Dữ liệu dựng quanh "hôm nay" theo giờ Việt Nam để test không hỏng theo thời gian
do $$
declare
  v_nay date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_khach uuid; v_bk1 bigint; v_bk2 bigint; v_bk3 bigint;
begin
  insert into guests (full_name, phone) values ('Khách Cảnh Báo', '0911111111') returning id into v_khach;

  -- Hợp đồng còn đúng 30 ngày
  insert into bookings (unit_id, guest_id, start_date, end_date, term_type, status)
    values ('f0000000-0000-4000-8000-0000000000ca', v_khach, v_nay - 60, v_nay + 30, 'dai_han', 'dang_o')
    returning id into v_bk1;

  -- Hợp đồng đã kết thúc, cọc vẫn ở trạng thái đã nhận
  insert into bookings (unit_id, guest_id, start_date, end_date, term_type, status, deposit_amount, deposit_status)
    values ('f0000000-0000-4000-8000-0000000000cb', v_khach, v_nay - 90, v_nay - 10, 'dai_han', 'ket_thuc', 5000000, 'da_nhan')
    returning id into v_bk2;

  -- Khoản thu quá hạn thuộc hợp đồng đang ở
  insert into payments (booking_id, kind, period_label, amount_due, amount_paid, due_date)
    values (v_bk1, 'tien_thue', 'T-test', 20000000, 0, v_nay - 5);

  -- Khách nhận phòng hôm nay (căn 2 đã trống từ 10 ngày trước), dùng để kiểm số điện thoại
  insert into bookings (unit_id, guest_id, start_date, end_date, term_type, status)
    values ('f0000000-0000-4000-8000-0000000000cb', v_khach, v_nay, v_nay + 5, 'ngan_han', 'da_coc')
    returning id into v_bk3;
end $$;

-- =====================================================================
-- 1. Sinh cảnh báo (chạy với quyền máy chủ, giống pg_cron)
-- =====================================================================
do $$
declare v_so int; v_nay date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  v_so := tao_canh_bao();
  if v_so < 3 then raise exception 'FAIL 1a: chờ ít nhất 3 cảnh báo, nhận %', v_so; end if;

  if not exists (select 1 from tasks where alert_key like 'hd30:%' and category = 'quan_ly'
                  and priority = 'thuong' and due_date = v_nay and source = 'canh_bao') then
    raise exception 'FAIL 1b: thiếu cảnh báo hợp đồng còn 30 ngày'; end if;

  if not exists (select 1 from tasks where alert_key like 'thu:%' and priority = 'cao') then
    raise exception 'FAIL 1c: thiếu cảnh báo khoản thu quá hạn'; end if;

  if not exists (select 1 from tasks where alert_key like 'coc:%') then
    raise exception 'FAIL 1d: thiếu cảnh báo cọc chưa hoàn'; end if;

  -- Hợp đồng còn 30 ngày thì chưa được nhắc mốc 15 và 7
  if exists (select 1 from tasks where alert_key like 'hd15:%' or alert_key like 'hd7:%') then
    raise exception 'FAIL 1e: nhắc sai mốc, hợp đồng mới còn 30 ngày'; end if;

  -- Không được ghi số tiền vào việc (việc hiện cho cả nhân viên buồng phòng)
  if exists (select 1 from tasks where alert_key is not null
              and (title ~ '[0-9]{6,}' or coalesce(detail,'') ~ '[0-9]{6,}')) then
    raise exception 'FAIL 1f: cảnh báo có ghi số tiền'; end if;
end $$;

-- =====================================================================
-- 2. Chạy lại không được tạo việc trùng
-- =====================================================================
do $$
declare v_truoc int; v_sau int; v_them int;
begin
  select count(*) into v_truoc from tasks where alert_key is not null;
  v_them := tao_canh_bao();
  select count(*) into v_sau from tasks where alert_key is not null;
  if v_sau <> v_truoc then raise exception 'FAIL 2: chạy lần hai tạo thêm % việc trùng', v_sau - v_truoc; end if;
  if v_them <> 0 then raise exception 'FAIL 2b: hàm báo tạo % việc trong khi không tạo gì', v_them; end if;
end $$;

-- =====================================================================
-- 3. Nhân viên và khách vãng lai không gọi được tao_canh_bao()
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
do $$
declare ok boolean := false;
begin
  begin perform tao_canh_bao(); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL 3a: nhân viên gọi được tao_canh_bao()'; end if;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare ok boolean := false;
begin
  begin perform tao_canh_bao(); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL 3b: khách vãng lai gọi được tao_canh_bao()'; end if;
end $$;

-- =====================================================================
-- 4. Chủ đầu tư xem được báo cáo nhưng KHÔNG thấy số điện thoại khách
-- =====================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000c4","role":"authenticated"}', true);
do $$
declare v jsonb;
begin
  v := bao_cao_ngay();
  if jsonb_array_length(v->'nhan_phong') = 0 then
    raise exception 'FAIL 4a: chủ đầu tư không xem được lịch nhận phòng'; end if;
  if (v->'nhan_phong'->0->>'sdt') is not null then
    raise exception 'FAIL 4b: chủ đầu tư thấy số điện thoại khách — lộ dữ liệu cá nhân'; end if;
  if (v->'nhan_phong'->0->>'khach') is null then
    raise exception 'FAIL 4c: chủ đầu tư không thấy tên khách (vẫn được phép thấy tên)'; end if;
end $$;

-- =====================================================================
-- 5. Quản lý vẫn thấy số điện thoại để còn liên hệ khách
-- =====================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
do $$
declare v jsonb;
begin
  v := bao_cao_ngay();
  if (v->'nhan_phong'->0->>'sdt') is null then
    raise exception 'FAIL 5: quản lý không thấy số điện thoại khách'; end if;
end $$;

reset role;
select 'CẢNH BÁO: 5/5 QUA' as ket_qua;

rollback;
