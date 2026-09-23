-- =====================================================================
-- HIỆN TÊN KHÁCH TRÊN LỊCH CÔNG KHAI
--
-- Chủ dự án quyết định ngày 23/09/2026: khách chưa đăng nhập được thấy
-- tên khách đang thuê trên lịch.
--
-- ĐÂY LÀ MỘT THAY ĐỔI VỀ QUYỀN RIÊNG TƯ, ngược với mục 3.1 và 13.2 của
-- hồ sơ thiết kế ban đầu. Sau migration này, họ tên khách nằm trong API
-- công khai: ai có link đều đọc được, kể cả khi không mở giao diện.
-- Vẫn KHÔNG lộ: số điện thoại, email, giấy tờ, giá thực thu, ghi chú.
--
-- Muốn thu lại thì tạo migration mới bỏ cột guest_name khỏi view — nhưng
-- dữ liệu đã ra ngoài thì không lấy lại được.
-- =====================================================================

drop view if exists public.public_availability;

create view public.public_availability as
  select b.unit_id, b.start_date, b.end_date, g.full_name as guest_name
    from public.bookings b
    left join public.guests g on g.id = b.guest_id
   where b.status in ('giu_cho','da_coc','dang_o') and b.deleted_at is null
     and b.unit_id in (select id from public.public_units);

grant select on public.public_availability to anon, authenticated;
