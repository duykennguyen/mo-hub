-- =====================================================================
-- KIỂM THỬ 3 PHƯƠNG ÁN MỖI BÀI (migration 20260929000004)
-- Dán vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA. Tự hoàn tác.
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';
insert into auth.users (id, email) values ('c9000000-0000-4000-8000-000000000001', 'test-admin@mo.test');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare v jsonb; p bigint; ok boolean;
  pa jsonb := '[{"so":1,"phong_cach":"Kể chuyện","body":"A"},{"so":2,"phong_cach":"Ngắn gọn","body":"B"},{"so":3,"phong_cach":"Thơ","body":"C"}]';
begin
  delete from content_slots; delete from content_versions; delete from content_posts; delete from content_topics;
  insert into content_topics (brand, topic) values ('bedding', 'TC phơi chăn');
  insert into content_posts (brand, status) values ('bedding', 'cho_viet');
  v := content_nhan_viec('may-duy', false, 'bedding');
  p := (v ->> 'post_id')::bigint;

  -- 1. Nộp kèm 3 phương án: lưu nguyên, trả lại cho bot
  v := content_nop_bai(p, 'may-duy', 'toàn văn', 'claude', pa);
  if jsonb_array_length(v -> 'options') <> 3 then raise exception 'FAIL 1a: không trả phương án (%)', v; end if;
  if (select options from content_versions where post_id = p and version_no = 1) <> pa then raise exception 'FAIL 1b: không lưu phương án'; end if;

  -- 2. Chọn phương án: chỉ nhận 1..3
  update content_posts set chosen_option = 2, status = 'da_duyet' where id = p;
  ok := false; begin update content_posts set chosen_option = 4 where id = p; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 2a: nhận phương án số 4'; end if;

  -- 3. Viết lại thì xóa lựa chọn cũ
  update content_posts set status = 'can_viet_lai', feedback_pending = 'ngắn hơn' where id = p;
  v := content_nhan_viec('may-duy', false, 'bedding');
  if (v ->> 'ban_truoc') <> 'toàn văn' then raise exception 'FAIL 3a: không gửi bản trước (%)', v; end if;
  perform content_nop_bai(p, 'may-duy', 'toàn văn 2', 'claude', pa);
  if (select chosen_option from content_posts where id = p) is not null then raise exception 'FAIL 3b: còn giữ lựa chọn của bản cũ'; end if;

  -- 4. Lời gọi cũ (không có phương án) vẫn chạy
  update content_posts set status = 'can_viet_lai' where id = p;
  perform content_nhan_viec('may-duy', false, 'bedding');
  perform content_nop_bai(p, 'may-duy', 'một bản', 'claude');
  if (select options from content_versions where post_id = p and version_no = 3) is not null then raise exception 'FAIL 4a'; end if;

  -- 5. Mảng phương án sai dạng bị chặn
  ok := false;
  begin insert into content_versions (post_id, version_no, body, engine, options) values (p, 9, 'x', 'claude', '{"a":1}'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 5a: nhận options không phải mảng'; end if;
end $$;
reset role;

-- 6. Chỉ máy chủ gọi được hàm nộp bài mới
do $$
begin
  if has_function_privilege('authenticated', 'public.content_nop_bai(bigint, text, text, text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.content_nop_bai(bigint, text, text, text, jsonb)', 'execute') then
    raise exception 'FAIL 6a: content_nop_bai gọi được từ ngoài máy chủ'; end if;
end $$;

select '3 phương án: tất cả kiểm thử đã qua' as ket_qua;
rollback;
