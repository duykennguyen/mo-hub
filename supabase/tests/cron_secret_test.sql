-- =====================================================================
-- KIỂM THỬ SECRET CỔNG CRON (migration 20260926000002)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA.
-- Tự hoàn tác ở cuối (kể cả thay đổi trong Vault). KHÔNG gọi thật tới bot.
-- =====================================================================
begin;

-- Khách vãng lai và người đăng nhập không đặt được secret
do $$
begin
  if has_function_privilege('anon', 'public.dat_cron_secret(text)', 'execute') then
    raise exception 'FAIL 1a: anon gọi được dat_cron_secret'; end if;
  if has_function_privilege('authenticated', 'public.dat_cron_secret(text)', 'execute') then
    raise exception 'FAIL 1b: người đăng nhập gọi được dat_cron_secret'; end if;
end $$;

-- Máy chủ đặt secret: quá ngắn bị từ chối; đặt lại thì cập nhật, không đẻ bản thứ hai
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare ok boolean := false;
begin
  begin perform dat_cron_secret('ngan'); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 2a: secret quá ngắn vẫn được nhận'; end if;
  perform dat_cron_secret(repeat('a', 64));
  perform dat_cron_secret(repeat('b', 64));
  perform dat_cron_secret(repeat('b', 64));
end $$;
reset role;

do $$
begin
  if (select count(*) from vault.decrypted_secrets where name = 'mo_cron_secret') <> 1 then
    raise exception 'FAIL 2b: Vault có nhiều hơn một secret cron'; end if;
  if (select decrypted_secret from vault.decrypted_secrets where name = 'mo_cron_secret') <> repeat('b', 64) then
    raise exception 'FAIL 2c: Vault không theo giá trị mới nhất'; end if;

  -- Job 08:00 gửi kèm secret đọc từ Vault, không chép cứng giá trị nào
  if not exists (select 1 from cron.job where jobname = 'thuki-bao-cao-sang'
                  and command like '%X-Mo-Cron-Secret%' and command like '%vault.decrypted_secrets%'
                  and schedule = '0 1 * * *') then
    raise exception 'FAIL 3a: job báo cáo sáng chưa gửi kèm secret từ Vault'; end if;
end $$;

select 'Secret cổng cron: tất cả kiểm thử đã qua' as ket_qua;
rollback;
