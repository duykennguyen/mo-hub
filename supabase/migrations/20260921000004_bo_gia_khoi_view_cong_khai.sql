-- =====================================================================
-- BỎ GIÁ NIÊM YẾT KHỎI VIEW CÔNG KHAI
--
-- Lý do: chủ dự án chốt (21/09/2026) giá thuê để "Liên hệ" trên mọi trang
-- cho khách, đồng bộ với web Mô House và Mô Bedding. Giao diện Mô House
-- Calendar không hiển thị giá, nhưng `public_units` vẫn trả về
-- list_rent_month / list_rent_night nên mở DevTools hoặc gọi API tay là
-- đọc được. Ẩn ở giao diện không phải là ẩn — phải sửa chính VIEW.
--
-- Giá vẫn nằm nguyên trong bảng `units`; thành viên đã đăng nhập vẫn đọc
-- bình thường qua RLS. Chỉ `anon` là không còn thấy.
--
-- Phải xóa rồi tạo lại (không dùng được `create or replace`) vì số cột
-- giảm đi. `public_availability` tham chiếu `public_units` nên xóa và
-- tạo lại luôn, giữ nguyên định nghĩa cũ.
-- =====================================================================

begin;

drop view if exists public.public_availability;
drop view if exists public.public_units;

-- Chỉ liệt kê cột được phép công khai. Tuyệt đối không `select *`.
create view public.public_units as
  select u.id, u.property_id, u.name, u.unit_type, u.bedrooms, u.max_guests,
         u.area_m2, u.sort
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.is_published and u.active and p.is_published and p.active;

-- Chỉ ngày bận/trống. KHÔNG tên khách, KHÔNG giá thực thu.
create view public.public_availability as
  select b.unit_id, b.start_date, b.end_date
    from public.bookings b
   where b.status in ('giu_cho','da_coc','dang_o') and b.deleted_at is null
     and b.unit_id in (select id from public.public_units);

grant select on public.public_units, public.public_availability to anon, authenticated;

commit;
