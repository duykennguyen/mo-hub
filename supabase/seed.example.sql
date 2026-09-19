-- =====================================================================
-- MẪU DỮ LIỆU NHÀ — chép file này thành seed.local.sql rồi điền nhà thật.
-- seed.local.sql đã nằm trong .gitignore: KHÔNG commit dữ liệu thật (repo public).
--
-- Chạy: dán nội dung seed.local.sql vào Supabase > SQL Editor > Run
--   hoặc: npx supabase db push --include-seed
--
-- code    : mã ngắn, dùng cho lệnh Thư kí /viec sen (không dùng để khớp tin nhắn tự do)
-- name    : tên đầy đủ
-- aliases : mọi cách hay gọi nhà đó khi nhắn Thư kí — CÓ DẤU, ưu tiên cụm 2 chữ
--           (từ bỏ dấu chỉ khớp khi dài ≥ 5 ký tự, để tránh "may" ≈ "máy")
-- sort    : thứ tự hiển thị trên web
-- =====================================================================
insert into public.properties (code, name, aliases, sort) values
  ('MAU1', 'Nhà mẫu một', '{"nhà mẫu một","căn mẫu một"}', 1),
  ('MAU2', 'Nhà mẫu hai', '{"nhà mẫu hai"}', 2)
on conflict (code) do update
  set name = excluded.name, aliases = excluded.aliases, sort = excluded.sort;

-- Kho link gửi khách (tùy chọn)
-- insert into public.share_links (grp, title, url, sort) values
--   ('Mô Bedding', 'Catalog Mô Bedding', 'https://duykennguyen.github.io/mo-bedding/', 1);
