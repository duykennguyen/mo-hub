-- =====================================================================
-- KIỂM THỬ QUYỀN GỌI HÀM (migration 20260922000007)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA.
-- Tự hoàn tác ở cuối, không để lại dữ liệu.
--
-- Bài này canh đúng lỗ hổng đã gặp ngày 22/09/2026: người chưa đăng nhập
-- (vai trò anon, dùng khóa công khai trong config.js) gọi được hàm báo cáo
-- và đọc được tên + số điện thoại khách.
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('a1000000-0000-4000-8000-000000000002', 'test-nhanvien@mo.test'),
  ('a1000000-0000-4000-8000-000000000003', 'test-chudautu@mo.test');
update profiles set status='approved', role='staff'  where id = 'a1000000-0000-4000-8000-000000000002';
update profiles set status='approved', role='viewer' where id = 'a1000000-0000-4000-8000-000000000003';

insert into properties (id, code, name) values ('b1000000-0000-4000-8000-00000000000a', 'TESTH', 'Nhà test hàm');
insert into units (id, property_id, code, name) values
  ('b1000000-0000-4000-8000-0000000000aa', 'b1000000-0000-4000-8000-00000000000a', 'U1', 'Căn test hàm');
insert into guests (id, full_name, phone) values
  ('b1000000-0000-4000-8000-0000000000bb', 'Khách Bí Mật', '0911222333');
insert into bookings (unit_id, guest_id, start_date, end_date, status, term_type, rent_amount)
  values ('b1000000-0000-4000-8000-0000000000aa', 'b1000000-0000-4000-8000-0000000000bb',
          current_date, current_date + 60, 'da_coc', 'dai_han', 20000000);

-- =====================================================================
-- KHÁCH VÃNG LAI (anon) — không được gọi bất kỳ hàm nào trong nhóm này
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare ok boolean;
begin
  ok := false;
  begin perform bao_cao_ngay();
  exception when insufficient_privilege then ok := true; when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 1a: anon gọi được bao_cao_ngay (lộ tên và SĐT khách)'; end if;

  ok := false;
  begin perform cap_nhat_trang_thai_booking();
  exception when insufficient_privilege then ok := true; when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 1b: anon đổi được trạng thái booking'; end if;

  ok := false;
  begin perform don_nhap_booking_cu();
  exception when insufficient_privilege then ok := true; when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 1c: anon xóa được bản nháp của Thư kí'; end if;

  ok := false;
  begin perform generate_rent_schedule(1);
  exception when insufficient_privilege then ok := true; when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 1d: anon sửa được lịch thu tiền'; end if;
end $$;

-- =====================================================================
-- NHÂN VIÊN — có đăng nhập nhưng không dính dáng đặt phòng
-- =====================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare ok boolean := false;
begin
  begin perform bao_cao_ngay();
  exception when insufficient_privilege then ok := true; when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 2a: nhân viên xem được báo cáo đặt phòng'; end if;

  ok := false;
  begin perform generate_rent_schedule(1);
  exception when insufficient_privilege then ok := true; when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 2b: nhân viên tạo được lịch thu tiền'; end if;
end $$;

-- =====================================================================
-- CHỦ ĐẦU TƯ — xem được báo cáo (không có SĐT trong phần đang ở), không sửa được
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$
declare bc jsonb; ok boolean := false;
begin
  bc := bao_cao_ngay();
  if (bc->>'ngay') is null then raise exception 'FAIL 3a: chủ đầu tư không xem được báo cáo'; end if;
  if jsonb_array_length(bc->'nhan_phong') <> 1 then
    raise exception 'FAIL 3b: báo cáo thiếu khách nhận phòng hôm nay'; end if;

  begin perform cap_nhat_trang_thai_booking();
  exception when insufficient_privilege then ok := true; when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 3c: chủ đầu tư chạy được hàm của máy chủ'; end if;
end $$;

-- =====================================================================
-- QUẢN TRỊ VIÊN — chạy tay được hàm cập nhật trạng thái
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$ begin
  perform cap_nhat_trang_thai_booking();
  if (bao_cao_ngay()->>'ngay') is null then
    raise exception 'FAIL 5a: admin không xem được báo cáo'; end if;
end $$;

-- =====================================================================
-- THƯ KÍ (service role) — vẫn chạy được mọi thứ như trước
-- =====================================================================
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare bc jsonb;
begin
  bc := bao_cao_ngay();
  if jsonb_array_length(bc->'nhan_phong') <> 1 then
    raise exception 'FAIL 4a: Thư kí không lấy được số liệu báo cáo'; end if;
  if (bc->'nhan_phong'->0->>'sdt') is distinct from '0911222333' then
    raise exception 'FAIL 4b: Thư kí phải thấy SĐT khách để còn gọi'; end if;
  perform cap_nhat_trang_thai_booking();
  perform don_nhap_booking_cu();
end $$;

reset role;
select 'Kiểm thử quyền gọi hàm đã qua' as ket_qua;
rollback;
