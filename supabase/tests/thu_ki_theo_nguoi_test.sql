-- =====================================================================
-- KIỂM THỬ: THƯ KÍ KIỂM QUYỀN THEO NGƯỜI NHẮN (migration 20260926000001)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA.
-- Chạy trong 1 transaction và ROLLBACK ở cuối, không để lại dữ liệu.
--
-- Giả lập đúng cách bot chạy thật:
--   · việc của máy chủ (tra liên kết, dùng mã)  → role service_role
--   · lệnh của người nhắn                         → role authenticated + sub của người đó
--                                                   + header x-mo-kenh: thu-ki
-- Nhân vật: anh Tâm (nhân viên, chỉ phụ trách Nhà A), chị Chủ (chỉ xem),
--           chị Quản lý (sẽ bị chặn), Test Admin.
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';

insert into auth.users (id, email) values
  ('e0000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('e0000000-0000-4000-8000-000000000002', 'test-tam@mo.test'),
  ('e0000000-0000-4000-8000-000000000003', 'test-chu@mo.test'),
  ('e0000000-0000-4000-8000-000000000004', 'test-quanly@mo.test'),
  ('e0000000-0000-4000-8000-000000000005', 'test-cho@mo.test');

update profiles set full_name = 'Test Admin' where id = 'e0000000-0000-4000-8000-000000000001';
update profiles set status = 'approved', role = 'staff', full_name = 'Anh Tâm', restrict_properties = true
  where id = 'e0000000-0000-4000-8000-000000000002';
update profiles set status = 'approved', role = 'viewer', full_name = 'Chị Chủ'
  where id = 'e0000000-0000-4000-8000-000000000003';
update profiles set status = 'approved', role = 'manager', full_name = 'Chị Quản lý'
  where id = 'e0000000-0000-4000-8000-000000000004';
-- test-cho@mo.test để nguyên trạng thái chờ duyệt

insert into properties (id, code, name) values
  ('f0000000-0000-4000-8000-00000000000a', 'TKA', 'Nhà A thư kí'),
  ('f0000000-0000-4000-8000-00000000000b', 'TKB', 'Nhà B thư kí');
insert into user_properties (user_id, property_id)
  values ('e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000a');
insert into units (id, property_id, code, name) values
  ('f0000000-0000-4000-8000-0000000000a1', 'f0000000-0000-4000-8000-00000000000a', 'A1', 'Căn A1 thư kí');
insert into tasks (property_id, title) values
  ('f0000000-0000-4000-8000-00000000000a', 'TK việc nhà A'),
  ('f0000000-0000-4000-8000-00000000000b', 'TK việc nhà B');

-- =====================================================================
-- 1. KHÁCH VÃNG LAI (khóa publishable) — không gọi được hàm nào mới
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare ok boolean;
begin
  ok := false; begin perform tao_ma_lien_ket_telegram(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 1a: anon lấy được mã liên kết'; end if;
  ok := false; begin perform bot_dung_ma_lien_ket(1, 'ABCDEFGH'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 1b: anon dùng được mã liên kết'; end if;
  ok := false; begin perform * from bot_nguoi_cua_chat(1); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 1c: anon tra được chat → người'; end if;
  ok := false; begin perform * from ds_lien_ket_telegram(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 1d: anon xem được danh sách liên kết'; end if;
  ok := false; begin perform thu_hoi_lien_ket_telegram(1); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 1e: anon ngắt được liên kết'; end if;
  ok := false; begin perform lien_ket_telegram_cua_toi(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 1f: anon gọi được lien_ket_telegram_cua_toi'; end if;
  ok := false; begin perform 1 from telegram_links; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 1g: anon đọc được bảng telegram_links'; end if;
end $$;
reset role;

-- =====================================================================
-- 2. LẤY MÃ TRÊN MÔ HUB (người đã duyệt, qua web)
-- =====================================================================
-- Người chờ duyệt không lấy được mã
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
do $$
declare ok boolean := false;
begin
  begin perform tao_ma_lien_ket_telegram(); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 2a: người chưa được duyệt lấy được mã liên kết'; end if;
end $$;

-- Anh Tâm lấy mã; không đọc được bảng mã, không tự dùng mã được
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('test.ma_tam_cu', tao_ma_lien_ket_telegram(), true);
select set_config('test.ma_tam', tao_ma_lien_ket_telegram(), true);     -- lấy lần 2: mã cũ phải mất hiệu lực
do $$
declare ok boolean;
begin
  if current_setting('test.ma_tam') !~ '^[A-HJ-NP-Z2-9]{8}$' then
    raise exception 'FAIL 2b: mã không đúng dạng 8 ký tự dễ đọc (%)', current_setting('test.ma_tam'); end if;
  ok := false; begin perform 1 from telegram_link_codes; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 2c: người dùng đọc được bảng mã'; end if;
  ok := false; begin perform bot_dung_ma_lien_ket(1001, current_setting('test.ma_tam')); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 2d: người dùng tự dùng mã qua API, không cần Telegram'; end if;
  if lien_ket_telegram_cua_toi() <> 0 then raise exception 'FAIL 2e: chưa liên kết mà báo đã liên kết'; end if;
end $$;

-- Chị Chủ (chỉ xem) và chị Quản lý cũng lấy mã
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('test.ma_chu', tao_ma_lien_ket_telegram(), true);
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select set_config('test.ma_ql', tao_ma_lien_ket_telegram(), true);
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('test.ma_admin_het_han', tao_ma_lien_ket_telegram(), true);
reset role;

-- Mã của admin cho quá hạn 10 phút; chị Quản lý bị chặn sau khi đã lấy mã
update telegram_link_codes set expires_at = now() - interval '1 minute'
 where profile_id = 'e0000000-0000-4000-8000-000000000001';
update profiles set status = 'rejected' where id = 'e0000000-0000-4000-8000-000000000004';

-- =====================================================================
-- 3. BOT DÙNG MÃ (máy chủ)
-- =====================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare r jsonb;
begin
  r := bot_dung_ma_lien_ket(1001, 'SAIMA234');
  if r ->> 'ly_do' is distinct from 'khong_dung' then raise exception 'FAIL 3a: mã sai không bị từ chối (%)', r; end if;

  r := bot_dung_ma_lien_ket(1001, current_setting('test.ma_tam_cu'));
  if r ->> 'ly_do' is distinct from 'khong_dung' then raise exception 'FAIL 3b: mã cũ (đã lấy mã mới) vẫn dùng được (%)', r; end if;

  r := bot_dung_ma_lien_ket(1009, current_setting('test.ma_admin_het_han'));
  if r ->> 'ly_do' is distinct from 'het_han' then raise exception 'FAIL 3c: mã hết hạn không bị từ chối (%)', r; end if;

  r := bot_dung_ma_lien_ket(1004, current_setting('test.ma_ql'));
  if r ->> 'ly_do' is distinct from 'chua_duyet' then raise exception 'FAIL 3d: người đã bị chặn vẫn liên kết được (%)', r; end if;

  -- Mã đúng: gõ chữ thường, thừa dấu cách vẫn nhận
  r := bot_dung_ma_lien_ket(1001, '  ' || lower(current_setting('test.ma_tam')) || ' ');
  if (r ->> 'ok')::boolean is not true or r ->> 'ten' <> 'Anh Tâm' then raise exception 'FAIL 3e: mã đúng không liên kết được (%)', r; end if;

  r := bot_dung_ma_lien_ket(1002, current_setting('test.ma_tam'));
  if r ->> 'ly_do' is distinct from 'da_dung' then raise exception 'FAIL 3f: mã đã dùng lại dùng được lần 2 (%)', r; end if;

  r := bot_dung_ma_lien_ket(1003, current_setting('test.ma_chu'));
  if (r ->> 'ok')::boolean is not true then raise exception 'FAIL 3g: chị Chủ không liên kết được (%)', r; end if;

  if (select ten from bot_nguoi_cua_chat(1001)) is distinct from 'Anh Tâm' then
    raise exception 'FAIL 3h: tra chat 1001 không ra anh Tâm'; end if;
  if exists (select 1 from bot_nguoi_cua_chat(9999)) then
    raise exception 'FAIL 3i: chat chưa liên kết vẫn ra một người'; end if;
  if exists (select 1 from bot_nguoi_cua_chat(1004)) or exists (select 1 from bot_nguoi_cua_chat(1009)) then
    raise exception 'FAIL 3j: mã bị từ chối nhưng vẫn tạo liên kết'; end if;
end $$;
reset role;

-- =====================================================================
-- 4. ANH TÂM NHẮN BOT (nhân viên, chỉ phụ trách Nhà A)
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{"x-mo-kenh":"thu-ki"}', true);
do $$
declare ok boolean; v_id bigint; n int;
begin
  -- /viec: chỉ thấy việc của nhà được giao
  if (select string_agg(title, ', ' order by title) from tasks where title like 'TK %') is distinct from 'TK việc nhà A' then
    raise exception 'FAIL 4a: /viec của nhân viên bị giới hạn thấy sai (%)',
      (select string_agg(title, ', ' order by title) from tasks where title like 'TK %'); end if;
  if (select count(*) from properties where code in ('TKA', 'TKB')) <> 1 then
    raise exception 'FAIL 4b: /nha thấy cả nhà không phụ trách'; end if;

  -- Ghi việc: nhật ký ghi "Anh Tâm (qua Thư kí)"
  insert into tasks (property_id, title, source) values ('f0000000-0000-4000-8000-00000000000a', 'TK việc qua bot', 'telegram')
  returning id into v_id;
  if (select created_by from tasks where id = v_id) is distinct from 'Anh Tâm (qua Thư kí)' then
    raise exception 'FAIL 4c: người tạo ghi sai (%)', (select created_by from tasks where id = v_id); end if;
  if (select actor from task_log where task_id = v_id and action = 'tao') is distinct from 'Anh Tâm (qua Thư kí)' then
    raise exception 'FAIL 4d: nhật ký ghi sai tên người nhắn'; end if;
  update tasks set status = 'done' where id = v_id;
  if (select done_by from tasks where id = v_id) is distinct from 'Anh Tâm (qua Thư kí)' then
    raise exception 'FAIL 4e: người hoàn thành ghi sai'; end if;

  -- Không ghi được việc cho nhà không phụ trách
  ok := false;
  begin insert into tasks (property_id, title) values ('f0000000-0000-4000-8000-00000000000b', 'TK lén');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 4f: ghi được việc cho nhà không phụ trách'; end if;

  -- Nút "Hủy việc" (xóa mềm) — chỉ admin
  ok := false;
  begin update tasks set deleted_at = now() where id = v_id; exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 4g: nhân viên xóa được việc qua bot'; end if;

  -- Tạo booking: bị từ chối vì can_book() sai
  if can_book() then raise exception 'FAIL 4h: can_book() của nhân viên lại đúng'; end if;
  ok := false;
  begin insert into bookings (unit_id, start_date, end_date) values ('f0000000-0000-4000-8000-0000000000a1', current_date + 100, current_date + 110);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 4i: nhân viên tạo được booking'; end if;
  ok := false;
  begin insert into bot_booking_drafts (text, payload) values ('đặt A1', '{}');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 4j: nhân viên tạo được nháp booking'; end if;
  if exists (select 1 from guests) then raise exception 'FAIL 4k: nhân viên đọc được bảng khách'; end if;

  -- Nháp việc: tạo được, là của mình
  insert into bot_drafts (text) values ('TK nháp của Tâm');
  if (select owner_id from bot_drafts where text = 'TK nháp của Tâm') is distinct from 'e0000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'FAIL 4l: nháp việc không gắn đúng người'; end if;

  -- Không tra được liên kết của người khác, không xem danh sách
  ok := false;
  begin perform * from ds_lien_ket_telegram(); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 4m: nhân viên xem được danh sách liên kết'; end if;
  if lien_ket_telegram_cua_toi() <> 1 then raise exception 'FAIL 4n: anh Tâm không thấy mình đã liên kết'; end if;
end $$;

-- Cùng người đó thao tác trên web (không có header) → nhãn không có "(qua Thư kí)"
select set_config('request.headers', '{}', true);
do $$
declare v_id bigint;
begin
  insert into tasks (property_id, title) values ('f0000000-0000-4000-8000-00000000000a', 'TK việc trên web') returning id into v_id;
  if (select created_by from tasks where id = v_id) is distinct from 'Anh Tâm' then
    raise exception 'FAIL 4o: thao tác trên web bị gắn nhãn Thư kí'; end if;
end $$;
reset role;

-- =====================================================================
-- 5. CHỊ CHỦ NHẮN BOT (chỉ xem) — không ghi được gì
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('request.headers', '{"x-mo-kenh":"thu-ki"}', true);
do $$
declare ok boolean; n int;
begin
  ok := false;
  begin insert into tasks (property_id, title) values ('f0000000-0000-4000-8000-00000000000a', 'TK việc của chủ');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 5a: người chỉ xem ghi được việc'; end if;

  update tasks set status = 'done' where title = 'TK việc nhà A';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5b: người chỉ xem đánh dấu xong được việc'; end if;

  ok := false;
  begin insert into bookings (unit_id, start_date, end_date) values ('f0000000-0000-4000-8000-0000000000a1', current_date + 100, current_date + 110);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 5c: người chỉ xem tạo được booking'; end if;

  ok := false;
  begin insert into bot_drafts (text) values ('TK nháp của chủ');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 5d: người chỉ xem tạo được nháp việc'; end if;

  ok := false;
  begin insert into guests (full_name) values ('TK khách lén');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 5e: người chỉ xem tạo được khách'; end if;

  -- Nhưng vẫn đọc được việc (quyền xem)
  if not exists (select 1 from tasks where title = 'TK việc nhà A') then
    raise exception 'FAIL 5f: người chỉ xem không đọc được việc'; end if;
  -- Nháp của anh Tâm không lọt sang người khác
  if exists (select 1 from bot_drafts) then raise exception 'FAIL 5g: thấy nháp của người khác'; end if;
end $$;
reset role;

-- =====================================================================
-- 6. ADMIN NGẮT LIÊN KẾT → chat đó coi như chưa liên kết
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{}', true);
do $$
begin
  if (select count(*) from ds_lien_ket_telegram() where chat_id in (1001, 1003)) <> 2 then
    raise exception 'FAIL 6a: admin không thấy đủ liên kết'; end if;
  perform thu_hoi_lien_ket_telegram(1001);
end $$;
reset role;
-- Chị Chủ bị chặn sau khi đã liên kết
update profiles set status = 'rejected' where id = 'e0000000-0000-4000-8000-000000000003';

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  if exists (select 1 from bot_nguoi_cua_chat(1001)) then raise exception 'FAIL 6b: liên kết đã ngắt vẫn còn hiệu lực'; end if;
  if exists (select 1 from bot_nguoi_cua_chat(1003)) then raise exception 'FAIL 6c: người đã bị chặn vẫn dùng được bot'; end if;
end $$;
reset role;

-- =====================================================================
-- 7. QUYỀN GỌI HÀM ĐÚNG MỤC 9.3b
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array['tao_ma_lien_ket_telegram()', 'lien_ket_telegram_cua_toi()', 'ds_lien_ket_telegram()',
                           'thu_hoi_lien_ket_telegram(bigint)', 'bot_dung_ma_lien_ket(bigint, text)',
                           'bot_nguoi_cua_chat(bigint)', 'qua_thu_ki()'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'FAIL 7a: anon còn quyền gọi %', f; end if;
  end loop;
  foreach f in array array['bot_dung_ma_lien_ket(bigint, text)', 'bot_nguoi_cua_chat(bigint)', 'don_nhap_booking_cu()'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception 'FAIL 7b: người đăng nhập gọi được hàm chỉ dành cho máy chủ %', f; end if;
  end loop;
end $$;

select 'Thư kí kiểm quyền theo người: tất cả kiểm thử đã qua' as ket_qua;
rollback;
