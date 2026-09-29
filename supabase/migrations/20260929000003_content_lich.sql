-- =====================================================================
-- BOT CONTENT — LỊCH TỰ ĐỘNG (pg_cron, giờ UTC = giờ VN − 7)
--   07:30 / 19:30  nhắc Duy nếu hàng đợi Mô House / Mô Bedding trống (không tự nghĩ chủ đề)
--   08:30 / 20:30  bộ máy dự phòng viết khung giờ nếu máy Duy chưa viết
-- Viết bài 08:00 / 20:00 do runner trên máy Duy tự canh giờ (Task Scheduler 10 phút/lần), không cần job ở đây.
-- Secret cổng cron đọc từ Vault (mo_cron_secret), giống báo cáo sáng của Thư kí.
-- pg_cron, pg_net đã bật trên dự án từ lịch Thư kí (supabase/cron/bao-cao-sang.sql).
-- =====================================================================

select cron.schedule('content-nhac-house', '30 0 * * *', $cron$
  select net.http_post(url := 'https://ggxgwbfrmndqslgprcpt.supabase.co/functions/v1/content-house-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Mo-Cron', 'nhac-hang-doi',
      'X-Mo-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'mo_cron_secret'), '')),
    body := '{}'::jsonb);
$cron$);

select cron.schedule('content-nhac-bedding', '30 12 * * *', $cron$
  select net.http_post(url := 'https://ggxgwbfrmndqslgprcpt.supabase.co/functions/v1/content-bedding-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Mo-Cron', 'nhac-hang-doi',
      'X-Mo-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'mo_cron_secret'), '')),
    body := '{}'::jsonb);
$cron$);

select cron.schedule('content-du-phong-house', '30 1 * * *', $cron$
  select net.http_post(url := 'https://ggxgwbfrmndqslgprcpt.supabase.co/functions/v1/content-fallback',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Mo-Cron', 'du-phong',
      'X-Mo-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'mo_cron_secret'), '')),
    body := '{"brand":"house"}'::jsonb, timeout_milliseconds := 120000);
$cron$);

select cron.schedule('content-du-phong-bedding', '30 13 * * *', $cron$
  select net.http_post(url := 'https://ggxgwbfrmndqslgprcpt.supabase.co/functions/v1/content-fallback',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Mo-Cron', 'du-phong',
      'X-Mo-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'mo_cron_secret'), '')),
    body := '{"brand":"bedding"}'::jsonb, timeout_milliseconds := 120000);
$cron$);

-- Chốt an toàn: mỗi job đúng một bản, chạy dưới quyền postgres
do $$
declare j text;
begin
  foreach j in array array['content-nhac-house', 'content-nhac-bedding', 'content-du-phong-house', 'content-du-phong-bedding'] loop
    if (select count(*) from cron.job where jobname = j) <> 1
       or (select username from cron.job where jobname = j) <> 'postgres' then
      raise exception 'Job % không đúng: cần đúng 1 job của postgres', j;
    end if;
  end loop;
end $$;
