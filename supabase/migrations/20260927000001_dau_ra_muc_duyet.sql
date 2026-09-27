-- =====================================================================
-- TASK CONTRACT: thêm "đầu ra" và "mức duyệt" cho việc (Blueprint Văn phòng AI, chặng 1)
--
-- dau_ra    : thế nào là xong. Không bắt buộc với việc người nhập tay (web, Telegram);
--             BẮT BUỘC với việc do agent tự sinh, để agent kiểm lại được việc đã thật sự xong
--             thay vì chỉ tin nút Xong.
-- muc_duyet : l0 chỉ đọc · l1 nháp chờ duyệt · l2 tự ghi nội bộ, đảo ngược được (mặc định).
--             L3 (tự gửi ra ngoài, chạm vào tiền) cố ý không có trong danh sách.
-- =====================================================================

alter table public.tasks
  add column dau_ra    text,
  add column muc_duyet text not null default 'l2' check (muc_duyet in ('l0', 'l1', 'l2'));

comment on column public.tasks.dau_ra is
  'Thế nào là xong. Bắt buộc với việc do agent sinh (source khác web/telegram).';
comment on column public.tasks.muc_duyet is
  'Mức duyệt: l0 chỉ đọc, l1 nháp chờ duyệt, l2 tự ghi nội bộ. Không có l3.';

-- ---------- Đầu ra mặc định cho việc cảnh báo tự động ----------
-- Khóa cảnh báo có dạng hd30:12, thu:45, coc:12 (xem tao_canh_bao()).
create or replace function public.dau_ra_canh_bao(p_alert_key text) returns text
language sql immutable set search_path = public as $$
  select case split_part(p_alert_key, ':', 1)
    when 'thu' then 'Khoản thu này đã được đánh dấu đã thu trên lịch đặt phòng'
    when 'coc' then 'Đã hoàn cọc hoặc đã ghi phần khấu trừ trên lịch đặt phòng'
    else case when p_alert_key like 'hd%'
      then 'Đã chốt với khách: gia hạn (có booking nối tiếp) hoặc ngày trả phòng và lịch hoàn cọc'
    end
  end
$$;

create or replace function public.tasks_dau_ra_mac_dinh() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.dau_ra is null and new.source = 'canh_bao' then
    new.dau_ra := dau_ra_canh_bao(new.alert_key);
  end if;
  return new;
end $$;
-- Tên bắt đầu bằng "a_" để chạy trước tasks_guard (Postgres chạy trigger theo thứ tự tên)
create trigger a_tasks_dau_ra before insert on public.tasks
for each row execute function public.tasks_dau_ra_mac_dinh();

-- Điền cho các việc cảnh báo đã có (update này đi qua trigger nhật ký như mọi thay đổi khác)
update public.tasks set dau_ra = dau_ra_canh_bao(alert_key)
 where source = 'canh_bao' and dau_ra is null;

-- Luật chung số 7 của Blueprint: việc do agent sinh phải có đầu ra.
-- Nguồn do người nhập: web, telegram. Mọi nguồn khác là agent.
alter table public.tasks add constraint tasks_agent_phai_co_dau_ra
  check (source in ('web', 'telegram') or nullif(btrim(dau_ra), '') is not null);

revoke all on function public.dau_ra_canh_bao(text)     from public, anon;
grant execute on function public.dau_ra_canh_bao(text)   to authenticated, service_role;
