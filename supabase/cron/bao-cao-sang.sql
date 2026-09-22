-- =====================================================================
-- LỊCH TỰ ĐỘNG CHO THƯ KÍ
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Chạy lại nhiều lần được.
--
-- 1) 08:00 giờ Việt Nam mỗi ngày: Thư kí nhắn báo cáo lịch khách.
-- 2) 06:00 giờ Việt Nam mỗi ngày: tự chuyển trạng thái booking theo ngày.
-- 3) 06:10 giờ Việt Nam mỗi ngày: sinh việc cảnh báo hợp đồng / thu tiền / cọc.
--
-- LƯU Ý: pg_cron chạy theo giờ UTC. Việt Nam = UTC+7 nên 08:00 VN = 01:00 UTC.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Xóa lịch cũ (nếu có) để chạy lại file này không bị trùng
select cron.unschedule('thuki-bao-cao-sang')
 where exists (select 1 from cron.job where jobname = 'thuki-bao-cao-sang');
select cron.unschedule('mo-cap-nhat-trang-thai-booking')
 where exists (select 1 from cron.job where jobname = 'mo-cap-nhat-trang-thai-booking');
select cron.unschedule('mo-canh-bao-hang-ngay')
 where exists (select 1 from cron.job where jobname = 'mo-canh-bao-hang-ngay');

-- 1) Báo cáo sáng — gọi Edge Function thuki-bot bằng header riêng.
--    Hàm tự chặn gửi trùng: tối đa 1 báo cáo mỗi 6 giờ, và chỉ gửi về ADMIN_CHAT_ID.
select cron.schedule('thuki-bao-cao-sang', '0 1 * * *', $cron$
  select net.http_post(
    url     := 'https://ggxgwbfrmndqslgprcpt.supabase.co/functions/v1/thuki-bot',
    headers := '{"Content-Type":"application/json","X-Mo-Cron":"bao-cao-sang"}'::jsonb,
    body    := '{}'::jsonb
  );
$cron$);

-- 2) Tự chuyển trạng thái: đã cọc → đang ở khi tới ngày vào; → kết thúc khi qua ngày ra
select cron.schedule('mo-cap-nhat-trang-thai-booking', '0 23 * * *', $cron$
  select public.cap_nhat_trang_thai_booking();
$cron$);

-- 3) Cảnh báo hằng ngày: hợp đồng còn 30/15/7 ngày, khoản thu quá hạn, cọc chưa hoàn.
--    Chạy 06:10 giờ VN, sau bước đổi trạng thái để số liệu đã đúng của ngày mới.
select cron.schedule('mo-canh-bao-hang-ngay', '10 23 * * *', $cron$
  select public.tao_canh_bao();
$cron$);

-- ---------------------------------------------------------------------
-- Kiểm tra: phải thấy 3 dòng, cột active = true
select jobname, schedule, active from cron.job order by jobname;

-- Xem 10 lần chạy gần nhất (sau khi lịch đã chạy ít nhất một lần):
--   select jobname, status, start_time, return_message
--   from cron.job_run_details order by start_time desc limit 10;

-- Muốn tắt báo cáo sáng:
--   select cron.unschedule('thuki-bao-cao-sang');
-- Muốn đổi giờ (ví dụ 07:00 VN = 00:00 UTC):
--   select cron.alter_job((select jobid from cron.job where jobname='thuki-bao-cao-sang'), schedule := '0 0 * * *');
