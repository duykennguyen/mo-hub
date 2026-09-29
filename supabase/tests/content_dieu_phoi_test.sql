-- =====================================================================
-- KIỂM THỬ ĐIỀU PHỐI BOT CONTENT (migration 20260929000002)
-- Giả lập: runner máy Duy ('may-duy') và bộ máy dự phòng ('du-phong') cùng tranh việc.
-- Dán vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA. Tự hoàn tác.
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';
insert into auth.users (id, email) values ('c8000000-0000-4000-8000-000000000001', 'test-admin@mo.test');
insert into telegram_links (chat_id, profile_id) values (777001, 'c8000000-0000-4000-8000-000000000001');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  l0759 timestamptz := (d + time '07:59') at time zone 'Asia/Ho_Chi_Minh';
  l0805 timestamptz := (d + time '08:05') at time zone 'Asia/Ho_Chi_Minh';
  l0830 timestamptz := (d + time '08:30') at time zone 'Asia/Ho_Chi_Minh';
  l2030 timestamptz := (d + time '20:30') at time zone 'Asia/Ho_Chi_Minh';
  l2100 timestamptz := (d + time '21:00') at time zone 'Asia/Ho_Chi_Minh';
  v jsonb; v2 jsonb; p bigint; ok boolean;
begin
  delete from content_slots; delete from content_versions; delete from content_posts; delete from content_topics;

  -- 1. Hàng đợi trống: không tự bịa chủ đề
  if content_nhan_viec('may-duy', false, null, l0805) is not null then raise exception 'FAIL 1a: hàng đợi trống vẫn có việc'; end if;

  -- 2. Khung 08:00 Mô House
  insert into content_topics (brand, topic, format) values ('house', 'TC Sen hoàng hôn', 'caption IG');
  insert into content_topics (brand, topic, priority) values ('house', 'TC ưu tiên cao', 5);
  if content_nhan_viec('may-duy', false, 'house', l0759) is not null then raise exception 'FAIL 2a: nhận khung trước 08:00'; end if;
  v := content_nhan_viec('may-duy', false, 'house', l0805);
  if v ->> 'loai' <> 'khung_gio' or v ->> 'chu_de' <> 'TC ưu tiên cao' then raise exception 'FAIL 2b: sai việc/khung hoặc sai thứ tự ưu tiên (%)', v; end if;
  p := (v ->> 'post_id')::bigint;
  if (select status from content_topics where topic = 'TC ưu tiên cao') <> 'da_dung' then raise exception 'FAIL 2c: chủ đề chưa đánh dấu đã dùng'; end if;
  -- dự phòng 08:30 không giành bài đang được máy Duy viết
  if content_nhan_viec('du-phong', true, 'house', l0830) is not null then raise exception 'FAIL 2d: dự phòng giành bài đang viết'; end if;
  -- máy Duy chạy lại trong cùng khung: không mở khung thứ hai
  if content_nhan_viec('may-duy', false, 'house', l0830) is not null then raise exception 'FAIL 2e: một khung sinh 2 bài'; end if;

  -- 3. Nộp bài
  ok := false; begin perform content_nop_bai(p, 'du-phong', 'x', 'du_phong'); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL 3a: bộ máy không giữ khóa vẫn nộp được'; end if;
  v := content_nop_bai(p, 'may-duy', 'Bản 1 của Sen', 'claude');
  if (select status from content_posts where id = p) <> 'cho_duyet' or (v ->> 'phien_ban')::int <> 1 then raise exception 'FAIL 3b: nộp bài sai trạng thái (%)', v; end if;
  if (select created_by from content_versions where post_id = p and version_no = 1) <> 'Content House (Claude)' then
    raise exception 'FAIL 3c: nhãn agent sai (%)', (select created_by from content_versions where post_id = p); end if;

  -- 4. Viết lại theo yêu cầu
  update content_posts set status = 'can_viet_lai', feedback_pending = 'Ngắn hơn, bỏ emoji' where id = p;
  v := content_nhan_viec('may-duy', false, null, l0830);
  if v ->> 'loai' <> 'viet_lai' or v ->> 'yeu_cau_sua' <> 'Ngắn hơn, bỏ emoji' or v ->> 'ban_truoc' <> 'Bản 1 của Sen' then
    raise exception 'FAIL 4a: gói viết lại thiếu bản trước hoặc yêu cầu sửa (%)', v; end if;
  perform content_nop_bai(p, 'may-duy', 'Bản 2 ngắn', 'claude');
  if (select feedback_before from content_versions where post_id = p and version_no = 2) <> 'Ngắn hơn, bỏ emoji'
     or (select feedback_pending from content_posts where id = p) is not null then raise exception 'FAIL 4b: yêu cầu sửa không được lưu vào phiên bản 2'; end if;
  -- dự phòng không viết lại
  update content_posts set status = 'can_viet_lai', feedback_pending = 'x' where id = p;
  if content_nhan_viec('du-phong', true, null, l0830) is not null then raise exception 'FAIL 4c: dự phòng nhận việc viết lại'; end if;
  update content_posts set status = 'cho_duyet', feedback_pending = null where id = p;

  -- 5. /vietngay khi hàng đợi bedding trống: nằm chờ; có chủ đề thì được viết
  insert into content_posts (brand) values ('bedding') returning id into p;
  if content_nhan_viec('may-duy', false, 'bedding', l0830) is not null then raise exception 'FAIL 5a: /vietngay tự bịa chủ đề'; end if;
  insert into content_topics (brand, topic) values ('bedding', 'TC lụa tre mùa mưa');
  v := content_nhan_viec('may-duy', false, 'bedding', l0830);
  if v ->> 'loai' <> 'viet_ngay' or v ->> 'chu_de' <> 'TC lụa tre mùa mưa' then raise exception 'FAIL 5b: /vietngay không nhận chủ đề (%)', v; end if;
  -- lỗi giữa chừng → nhả việc → quay về chờ
  perform content_nha_viec(p, 'may-duy');
  if (select status from content_posts where id = p) <> 'cho_viet' then raise exception 'FAIL 5c: nhả việc sai trạng thái'; end if;
  update content_posts set status = 'huy' where id = p;

  -- 6. Máy tắt cả tối: dự phòng 20:30 viết khung bedding; máy bật 21:00 không sinh bài trùng
  insert into content_topics (brand, topic) values ('bedding', 'TC chăn cho khách ở dài');
  v := content_nhan_viec('du-phong', true, 'bedding', l2030);
  if v ->> 'loai' <> 'khung_gio' then raise exception 'FAIL 6a: dự phòng không nhận khung 20:00 (%)', v; end if;
  perform content_nop_bai((v ->> 'post_id')::bigint, 'du-phong', 'Bản dự phòng', 'du_phong');
  if (select created_by from content_versions where post_id = (v ->> 'post_id')::bigint) <> 'Content Bedding (dự phòng)' then raise exception 'FAIL 6b: nhãn dự phòng sai'; end if;
  insert into content_topics (brand, topic) values ('bedding', 'TC dư');
  v2 := content_nhan_viec('may-duy', false, 'bedding', l2100);
  if v2 is not null then raise exception 'FAIL 6c: máy bật lại sinh bài trùng khung (%)', v2; end if;
  if (select count(*) from content_slots where brand = 'bedding') <> 1 then raise exception 'FAIL 6d: có hơn một khung bedding'; end if;

  -- 7. Máy giành khung 08:00 rồi chết: dự phòng nhận lại sau 30 phút khóa
  delete from content_slots where brand = 'house';
  update content_topics set status = 'cho' where topic = 'TC Sen hoàng hôn';
  v := content_nhan_viec('may-duy', false, 'house', l0805);
  update content_posts set claimed_at = now() - interval '31 minutes' where id = (v ->> 'post_id')::bigint;
  v2 := content_nhan_viec('du-phong', true, 'house', l0830);
  if (v2 ->> 'post_id') is distinct from (v ->> 'post_id') then raise exception 'FAIL 7a: dự phòng không nhận lại khung bị bỏ dở (%)', v2; end if;

  -- 8. Chat admin nhận nháp
  if not exists (select 1 from content_chat_admin() c where c = 777001) then raise exception 'FAIL 8a: không thấy chat admin'; end if;
end $$;
reset role;

-- 9. Người đăng nhập và khách không gọi được hàm điều phối
do $$
declare f text;
begin
  foreach f in array array['content_nhan_viec(text, boolean, text, timestamptz)', 'content_nop_bai(bigint, text, text, text)',
                           'content_nha_viec(bigint, text)', 'content_chat_admin()', 'content_luu_skill(text, text, text)', 'content_lay_skill(text)'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'FAIL 9a: % gọi được từ ngoài máy chủ', f; end if;
  end loop;
end $$;

select 'Điều phối bot Content: tất cả kiểm thử đã qua' as ket_qua;
rollback;
