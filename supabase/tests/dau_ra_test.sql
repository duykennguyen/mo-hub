-- =====================================================================
-- KIỂM THỬ TASK CONTRACT: dau_ra + muc_duyet (migration 20260927000001)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA. Tự hoàn tác.
-- =====================================================================
begin;

insert into properties (id, code, name) values ('d7000000-0000-4000-8000-00000000000a', 'TDR', 'Nhà test đầu ra');

do $$
declare ok boolean; v_id bigint;
begin
  -- Việc người nhập: không cần đầu ra, mặc định mức l2
  insert into tasks (property_id, title, source) values ('d7000000-0000-4000-8000-00000000000a', 'TDR việc web', 'web') returning id into v_id;
  if (select muc_duyet from tasks where id = v_id) <> 'l2' then raise exception 'FAIL 1a: mức duyệt mặc định không phải l2'; end if;
  insert into tasks (property_id, title, source) values ('d7000000-0000-4000-8000-00000000000a', 'TDR việc telegram', 'telegram');

  -- Việc cảnh báo tự sinh: tự có đầu ra theo khóa
  insert into tasks (title, source, alert_key) values ('TDR cọc', 'canh_bao', 'coc:999999') returning id into v_id;
  if (select dau_ra from tasks where id = v_id) not like 'Đã hoàn cọc%' then raise exception 'FAIL 2a: việc cảnh báo cọc không có đầu ra'; end if;
  insert into tasks (title, source, alert_key) values ('TDR hợp đồng', 'canh_bao', 'hd7:999999') returning id into v_id;
  if (select dau_ra from tasks where id = v_id) is null then raise exception 'FAIL 2b: việc cảnh báo hợp đồng không có đầu ra'; end if;
  insert into tasks (title, source, alert_key) values ('TDR thu', 'canh_bao', 'thu:999999') returning id into v_id;
  if (select dau_ra from tasks where id = v_id) is null then raise exception 'FAIL 2c: việc cảnh báo thu tiền không có đầu ra'; end if;

  -- Agent khác mà không ghi đầu ra → database từ chối
  ok := false;
  begin insert into tasks (title, source) values ('TDR agent quên đầu ra', 'agent_lead');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 3a: agent tạo được việc không có đầu ra'; end if;
  ok := false;
  begin insert into tasks (title, source, dau_ra) values ('TDR agent đầu ra rỗng', 'agent_lead', '   ');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 3b: agent tạo được việc với đầu ra rỗng'; end if;
  insert into tasks (title, source, dau_ra) values ('TDR agent đủ', 'agent_lead', 'Đã gọi lại khách');

  -- Không có mức l3
  ok := false;
  begin insert into tasks (title, muc_duyet) values ('TDR l3', 'l3');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 4a: tạo được việc mức l3'; end if;

  -- Mọi việc cảnh báo đang có đều đã có đầu ra
  if exists (select 1 from tasks where source = 'canh_bao' and dau_ra is null) then
    raise exception 'FAIL 5a: còn việc cảnh báo cũ chưa có đầu ra'; end if;
end $$;

-- Hàm tạo cảnh báo thật vẫn chạy được với ràng buộc mới
do $$ begin perform tao_canh_bao(); end $$;

select 'Task contract (dau_ra, muc_duyet): tất cả kiểm thử đã qua' as ket_qua;
rollback;
