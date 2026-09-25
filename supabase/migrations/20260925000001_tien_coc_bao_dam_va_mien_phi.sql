-- =====================================================================
-- TÁCH "TRẢ TRƯỚC" KHỎI "CỌC BẢO ĐẢM", THÊM MIỄN PHÍ TIỀN PHÒNG
--
-- Chủ dự án làm rõ ngày 25/09/2026: có HAI khoản tiền khác hẳn nhau mà
-- trước đây bị gộp làm một.
--
--   1. Khách TRẢ TRƯỚC — trả trước một phần hoặc toàn bộ tiền phòng.
--      Là doanh thu, trừ thẳng vào hóa đơn, không hoàn lại.
--      Vẫn dùng cột cũ `deposit_amount` / `deposit_status`.
--
--   2. Tiền CỌC BẢO ĐẢM — thu trước để bảo đảm khách ở tử tế. KHÔNG phải
--      doanh thu; cuối kỳ trừ các khoản phát sinh rồi HOÀN LẠI cho khách.
--      Cột mới `security_deposit` / `security_deposit_status`.
--
-- Hai khoản này độc lập với nhau và độc lập với kênh bán: một lượt qua
-- Airbnb vẫn có thể có cọc bảo đảm.
--
-- Thêm `is_free` cho các lượt không thu tiền phòng (khách mời, đổi dịch
-- vụ, ở thử). Dịch vụ phát sinh vẫn tính tiền bình thường.
-- =====================================================================

alter table public.bookings
  add column security_deposit        bigint,
  add column security_deposit_status text,     -- chua_thu / dang_giu / da_hoan / khau_tru
  add column is_free                 boolean not null default false;

comment on column public.bookings.deposit_amount is
  'Khách trả trước một phần tiền phòng. Là doanh thu, không hoàn lại.';
comment on column public.bookings.security_deposit is
  'Cọc bảo đảm, không phải doanh thu. Trừ phát sinh rồi hoàn lại khách.';
comment on column public.bookings.is_free is
  'Miễn phí tiền phòng. Dịch vụ phát sinh vẫn thu bình thường.';

-- Chủ đầu tư xem lịch qua view này nên phải thấy cả hai khoản
drop view if exists public.bookings_viewer;
create view public.bookings_viewer as
  select b.id, b.unit_id, b.start_date, b.end_date, b.term_type, b.status,
         b.rent_amount, b.deposit_amount, b.deposit_status, b.channel,
         b.security_deposit, b.security_deposit_status, b.is_free,
         b.commission_amount, b.broker_name, b.note,
         g.full_name as guest_name
    from public.bookings b
    left join public.guests g on g.id = b.guest_id
   where b.deleted_at is null and can_view_booking();
revoke all on public.bookings_viewer from anon;
grant select on public.bookings_viewer to authenticated;
