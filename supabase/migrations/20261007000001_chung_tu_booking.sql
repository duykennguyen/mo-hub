-- =====================================================================
-- CHỨNG TỪ ĐÍNH KÈM BOOKING (07/10/2026)
--
-- Chủ dự án chụp hộ chiếu / CCCD / ảnh ghi chú rồi gửi cho bot Lễ tân,
-- bot lưu ảnh và gắn vào booking của khách. Lịch Mô House hiện ảnh trong
-- phần "Ghi chú" của booking.
--
-- Đây là DỮ LIỆU CÁ NHÂN (Nghị định 13/2023): ảnh giấy tờ tùy thân.
--   · Kho ảnh RIÊNG TƯ (public = false) — không có link công khai,
--     web chỉ xem được qua link ký có hạn (createSignedUrl).
--   · Chỉ admin + quản lý (can_book) xem/thêm. Chủ đầu tư (viewer) và
--     nhân viên KHÔNG thấy, giống quy tắc SĐT/giấy tờ khách ở mục 5.2.
--   · Xóa: chỉ admin.
-- =====================================================================

create table public.booking_files (
  id          bigint generated always as identity primary key,
  booking_id  bigint not null references public.bookings(id) on delete cascade,
  path        text   not null unique,          -- đường dẫn trong kho 'chung-tu-khach'
  kind        text   not null default 'khac'
              check (kind in ('passport', 'cccd', 'ghi_chu', 'khac')),
  caption     text,
  mime        text,
  size_bytes  int,
  created_by  text   default public.actor_label(),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index on public.booking_files (booking_id);

alter table public.booking_files enable row level security;
create policy "booking_files: xem" on public.booking_files for select
  using (can_book() and (deleted_at is null or is_admin()));
create policy "booking_files: thêm" on public.booking_files for insert with check (can_book());
create policy "booking_files: sửa"  on public.booking_files for update using (is_admin()) with check (is_admin());
create policy "booking_files: xóa"  on public.booking_files for delete using (is_admin());
revoke all on public.booking_files from anon;

-- ---------- Kho ảnh riêng tư ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chung-tu-khach', 'chung-tu-khach', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false;

create policy "chung-tu-khach: xem" on storage.objects for select to authenticated
  using (bucket_id = 'chung-tu-khach' and public.can_book());
create policy "chung-tu-khach: thêm" on storage.objects for insert to authenticated
  with check (bucket_id = 'chung-tu-khach' and public.can_book());
create policy "chung-tu-khach: xóa" on storage.objects for delete to authenticated
  using (bucket_id = 'chung-tu-khach' and public.is_admin());
