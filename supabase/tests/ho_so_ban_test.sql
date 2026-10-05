-- =====================================================================
-- KIỂM THỬ HỒ SƠ CHUYỂN NHƯỢNG + AGENT HỒ SƠ (migration 20260928000001)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA. Tự hoàn tác.
-- Dữ liệu dưới đây là giả, chỉ để kiểm luật.
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';
insert into auth.users (id, email) values
  ('ab000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('ab000000-0000-4000-8000-000000000002', 'test-nv@mo.test');
update profiles set status = 'approved', role = 'staff' where id = 'ab000000-0000-4000-8000-000000000002';

-- =====================================================================
-- 1. ADMIN NẠP HỒ SƠ: một cái đạt, một cái thiếu pháp lý, một cái thiếu mandate
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('test.kq', nhap_tai_san_ban($j${"tai_san": [
  {"property": {"code": "TBA", "name": "Nhà test đạt", "aliases": ["test đạt"], "kind": "villa"},
   "listing": {"slug": "test-dat", "title": "Nhà test đạt", "asking_price": 1000000000, "summary": "Mô tả",
               "land_area_m2": 100, "map_url": "https://maps.app.goo.gl/x", "cover_url": "anh/a.jpg",
               "photos": [{"url":"anh/1.jpg"},{"url":"anh/2.jpg"},{"url":"anh/3.jpg"},{"url":"anh/4.jpg"}],
               "highlights": ["a","b","c"], "risks": ["Lối đi 2 m"],
               "legal_public": {"hinh_thuc": "Sổ đỏ", "tinh_trang": "Đầy đủ"}, "xuat_ban": true},
   "private": {"legal_detail": "GCN TEST 000", "sale_mandate_confirmed": true, "mandate_note": "test"}},
  {"property": {"code": "TBB", "name": "Nhà test thiếu pháp lý"},
   "listing": {"slug": "test-thieu-phap-ly", "title": "Nhà test thiếu pháp lý", "asking_price": 2000000000,
               "risks": ["x"], "xuat_ban": true},
   "private": {"sale_mandate_confirmed": true}},
  {"property": {"code": "TBC", "name": "Nhà test chưa mandate"},
   "listing": {"slug": "test-chua-mandate", "title": "Nhà test chưa mandate", "asking_price": 3000000000,
               "risks": ["x"], "legal_public": {"hinh_thuc": "Sổ đỏ", "tinh_trang": "Đầy đủ"}, "xuat_ban": true},
   "private": {"legal_detail": "GCN TEST 001"}}
]}$j$::jsonb)::text, true);

do $$
declare kq jsonb := current_setting('test.kq')::jsonb; ok boolean;
begin
  if (select (e ->> 'xuat_ban')::boolean from jsonb_array_elements(kq) e where e ->> 'slug' = 'test-dat') is not true then
    raise exception 'FAIL 1a: hồ sơ đủ điều kiện không xuất bản được (%)', kq; end if;
  if (select e ->> 'ly_do' from jsonb_array_elements(kq) e where e ->> 'slug' = 'test-thieu-phap-ly') not like '%pháp lý%' then
    raise exception 'FAIL 1b: hồ sơ thiếu pháp lý vẫn xuất bản (%)', kq; end if;
  if (select e ->> 'ly_do' from jsonb_array_elements(kq) e where e ->> 'slug' = 'test-chua-mandate') not like '%mandate%' then
    raise exception 'FAIL 1c: hồ sơ chưa xác nhận mandate vẫn xuất bản (%)', kq; end if;

  -- Bật xuất bản trực tiếp cũng bị chặn
  ok := false;
  begin update sale_listings set is_published = true where slug = 'test-thieu-phap-ly';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 1d: bật xuất bản trực tiếp lách được agent Hồ sơ'; end if;

  -- Điểm hồ sơ: bản đạt = 100%, bản thiếu có liệt kê còn thiếu gì
  if (select diem from ho_so_ban_diem() where slug = 'test-dat') <> 100 then
    raise exception 'FAIL 1e: hồ sơ đủ mà điểm không phải 100 (%)', (select thieu from ho_so_ban_diem() where slug = 'test-dat'); end if;
  if (select 'pháp lý công khai' = any(thieu) from ho_so_ban_diem() where slug = 'test-thieu-phap-ly') is not true then
    raise exception 'FAIL 1f: điểm hồ sơ không báo thiếu pháp lý'; end if;

  -- Nạp lại lần 2 không đẻ thêm dòng
  perform nhap_tai_san_ban($j${"tai_san": [{"property": {"code": "TBA"}, "listing": {"slug": "test-dat", "title": "Nhà test đạt (sửa)", "xuat_ban": false}, "private": {}}]}$j$::jsonb);
  if (select count(*) from sale_listings where slug like 'test-%') <> 3 then raise exception 'FAIL 1g: nạp lại sinh dòng trùng'; end if;
  if (select title from sale_listings where slug = 'test-dat') <> 'Nhà test đạt (sửa)' then raise exception 'FAIL 1h: nạp lại không cập nhật'; end if;
end $$;
-- đưa bản đạt về trạng thái xuất bản cho phần sau
select nhap_tai_san_ban($j${"tai_san": [
  {"property": {"code": "TBA"},
   "listing": {"slug": "test-dat", "title": "Nhà test đạt", "asking_price": 1000000000, "price_note": "≈ 10 triệu/m²", "risks": ["Lối đi 2 m"],
               "legal_public": {"hinh_thuc": "Sổ đỏ", "tinh_trang": "Đầy đủ"}, "xuat_ban": true},
   "private": {"legal_detail": "GCN TEST 000", "sale_mandate_confirmed": true}}]}$j$::jsonb);
reset role;

-- =====================================================================
-- 2. KHÁCH VÃNG LAI (site công khai)
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare ok boolean;
begin
  if (select string_agg(slug, ',') from public_sale_listings where slug like 'test-%') is distinct from 'test-dat' then
    raise exception 'FAIL 2a: view công khai hiện sai danh sách (%)', (select string_agg(slug, ',') from public_sale_listings where slug like 'test-%'); end if;
  -- Giá chào bán ẩn khỏi site công khai từ 05/10/2026 (khách bấm liên hệ)
  if (select asking_price is not null or price_note is not null from public_sale_listings where slug = 'test-dat') then
    raise exception 'FAIL 2b: view công khai lộ giá chào hoặc ghi chú giá'; end if;
  ok := false; begin perform 1 from sale_listings; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 2c: anon đọc được bảng gốc sale_listings'; end if;
  ok := false; begin perform 1 from property_private; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 2d: anon đọc được pháp lý chi tiết'; end if;
  ok := false; begin perform nhap_tai_san_ban('{}'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 2e: anon gọi được hàm nạp hồ sơ'; end if;
  ok := false; begin perform * from ho_so_ban_diem(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 2f: anon gọi được hàm chấm hồ sơ'; end if;
end $$;
reset role;

-- View công khai không được có cột nhạy cảm
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'public_sale_listings'
              and column_name in ('property_id', 'legal_detail', 'sale_mandate_confirmed', 'mandate_note', 'is_published')) then
    raise exception 'FAIL 2g: view công khai lộ cột nội bộ'; end if;
end $$;

-- =====================================================================
-- 3. NHÂN VIÊN: xem được hồ sơ bán, không sửa, không thấy pháp lý chi tiết
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare ok boolean; n int;
begin
  if not exists (select 1 from sale_listings where slug = 'test-dat') then raise exception 'FAIL 3a: nhân viên không xem được hồ sơ bán'; end if;
  update sale_listings set asking_price = 1 where slug = 'test-dat';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3b: nhân viên sửa được giá chào'; end if;
  if exists (select 1 from property_private) then raise exception 'FAIL 3c: nhân viên thấy pháp lý chi tiết'; end if;
  ok := false; begin perform nhap_tai_san_ban('{"tai_san":[]}'); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 3d: nhân viên nạp được hồ sơ'; end if;
  ok := false; begin perform * from ho_so_ban_diem(); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 3e: nhân viên xem được điểm hồ sơ'; end if;
end $$;
reset role;

select 'Hồ sơ chuyển nhượng + agent Hồ sơ: tất cả kiểm thử đã qua' as ket_qua;
rollback;
