-- =====================================================================
-- SECRET CHO CỔNG CRON CỦA THƯ KÍ
--
-- Trước đây header "X-Mo-Cron: bao-cao-sang" không có secret: ai gọi cũng được,
-- chỉ bị chặn bởi giới hạn 1 lần / 6 giờ. Từ nay:
--   · Edge Function Secret CRON_SECRET là bản gốc (đặt bằng `supabase secrets set`).
--   · Bot tự chép giá trị đó vào Supabase Vault (tên mo_cron_secret) qua hàm dat_cron_secret().
--     Không dán secret vào file này: repo công khai, và lịch sử migration lưu nguyên văn SQL.
--   · Job pg_cron đọc secret từ Vault, gửi kèm header X-Mo-Cron-Secret.
--   · Sai secret → bot trả 403. Giới hạn 1 lần / 6 giờ vẫn giữ làm lớp thứ hai.
-- =====================================================================

create or replace function public.dat_cron_secret(p_secret text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_cu text;
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ mới đặt được secret cron'; end if;
  if coalesce(length(p_secret), 0) < 32 then raise exception 'CRON_SECRET phải dài ít nhất 32 ký tự'; end if;

  select id, decrypted_secret into v_id, v_cu from vault.decrypted_secrets where name = 'mo_cron_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'mo_cron_secret', 'Secret cổng cron của Thư kí (bản gốc: Edge Function Secret CRON_SECRET)');
  elsif v_cu is distinct from p_secret then
    perform vault.update_secret(v_id, p_secret);
  end if;
end $$;

revoke all on function public.dat_cron_secret(text) from public, anon, authenticated;
grant execute on function public.dat_cron_secret(text) to service_role;

-- Báo cáo 08:00 giờ VN (01:00 UTC). Đặt lại job cùng tên → pg_cron cập nhật job cũ.
-- Vault chưa có secret thì header rỗng → bot trả 403, không gửi gì.
select cron.schedule('thuki-bao-cao-sang', '0 1 * * *', $cron$
  select net.http_post(
    url     := 'https://ggxgwbfrmndqslgprcpt.supabase.co/functions/v1/thuki-bot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Mo-Cron', 'bao-cao-sang',
      'X-Mo-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'mo_cron_secret'), '')
    ),
    body    := '{}'::jsonb
  );
$cron$);

-- Chốt an toàn: phải còn đúng MỘT job báo cáo sáng, chạy dưới quyền postgres như trước.
-- Sai thì cả migration hủy, không để lại job thứ hai gửi trùng báo cáo.
do $$
begin
  if (select count(*) from cron.job where jobname = 'thuki-bao-cao-sang') <> 1
     or (select username from cron.job where jobname = 'thuki-bao-cao-sang') <> 'postgres' then
    raise exception 'Job thuki-bao-cao-sang không đúng: cần đúng 1 job của postgres (hiện: %)',
      (select string_agg(username, ', ') from cron.job where jobname = 'thuki-bao-cao-sang');
  end if;
end $$;
