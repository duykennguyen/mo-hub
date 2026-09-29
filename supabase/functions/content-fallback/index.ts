// Bộ máy viết dự phòng: pg_cron 08:30 / 20:30 gọi khi khung giờ chưa có bài
import { contentFallback } from "../_shared/content-server.ts";
Deno.serve(contentFallback);
