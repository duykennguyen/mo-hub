-- =====================================================================
-- ẢNH GIẤY TỜ KHÁCH TỰ XÓA SAU 3 THÁNG (quyết định chủ dự án 07/10/2026)
--
-- Nghị định 13/2023: chỉ giữ dữ liệu cá nhân trong thời gian cần thiết.
-- Một ảnh bị xóa khi CẢ HAI điều kiện đúng:
--   · đã lưu từ 3 tháng trở lên, và
--   · khách đã trả phòng (end_date <= hôm nay) — khách thuê dài hạn còn đang ở
--     thì chưa xóa, để còn đối chiếu khi cần.
--
-- Xóa file thật phải đi qua Storage API (xóa dòng trong storage.objects bằng SQL
-- không xóa file), nên hàm này chỉ TRẢ VỀ danh sách; bot Lễ tân gọi nó trong
-- lượt báo cáo 08:00 (quyền máy chủ), xóa file trong kho rồi xóa dòng booking_files.
-- =====================================================================

create or replace function public.chung_tu_qua_han()
returns table (id bigint, path text)
language sql stable security definer set search_path = public as $$
  select f.id, f.path
    from booking_files f
    join bookings b on b.id = f.booking_id
   where f.created_at <= now() - interval '3 months'
     and b.end_date <= (now() at time zone 'Asia/Ho_Chi_Minh')::date
$$;

-- Chỉ máy chủ (bot, service_role) gọi được — người dùng không cần và không được liệt kê đường dẫn ảnh
revoke all on function public.chung_tu_qua_han() from public, anon, authenticated;
grant execute on function public.chung_tu_qua_han() to service_role;

comment on table public.booking_files is
  'Ảnh hộ chiếu/CCCD/ghi chú của booking. Tự xóa khi đã lưu ≥ 3 tháng và khách đã trả phòng (chung_tu_qua_han, chạy 08:00).';
