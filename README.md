# Mô Hub

Hệ thống vận hành nội bộ của Mô Đi Phê (Hội An): giao việc theo nhà, nhật ký thay đổi, duyệt thành viên, kho link gửi khách và bot **Thư kí** trên Telegram.

- Giao diện: HTML/CSS/JS thuần trong `web/`, chạy trên GitHub Pages.
- Dữ liệu: Supabase (Postgres + đăng nhập + phân quyền theo dòng). Repo này **không chứa dữ liệu** — chỉ có code.
- Toàn bộ dùng gói miễn phí.

## Bắt đầu

- Cài đặt từng bước: [docs/HUONG-DAN-CAI-DAT.md](docs/HUONG-DAN-CAI-DAT.md)
- Kiến trúc, quyết định đã chốt, lộ trình: [CLAUDE.md](CLAUDE.md)

## Kiểm thử

| Phần | Cách chạy |
|---|---|
| Phân quyền database | Dán `supabase/tests/rls_test.sql` vào Supabase SQL Editor → Run. Không lỗi = đạt |
| Bộ đọc tin nhắn Thư kí | `deno test supabase/functions/thuki-bot/` |

## Bảo mật

Không bao giờ commit: service_role key, token Telegram, key Resend, `APPROVE_SECRET`, file `.env*`, `supabase/seed.local.sql`. Các khóa bí mật chỉ nằm trong Supabase → Edge Functions → Secrets.
