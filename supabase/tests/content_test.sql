-- =====================================================================
-- KIỂM THỬ BOT CONTENT — GIAI ĐOẠN A (migration 20260929000001)
-- Dán toàn bộ vào Supabase > SQL Editor > Run. Không lỗi đỏ = QUA. Tự hoàn tác.
-- =====================================================================
begin;

update public.app_settings set value = 'test-admin@mo.test' where key = 'admin_email';
insert into auth.users (id, email) values
  ('c7000000-0000-4000-8000-000000000001', 'test-admin@mo.test'),
  ('c7000000-0000-4000-8000-000000000002', 'test-ql@mo.test'),
  ('c7000000-0000-4000-8000-000000000003', 'test-nv@mo.test'),
  ('c7000000-0000-4000-8000-000000000004', 'test-chu@mo.test');
update profiles set full_name = 'Duy Test' where id = 'c7000000-0000-4000-8000-000000000001';
update profiles set status = 'approved', role = 'manager' where id = 'c7000000-0000-4000-8000-000000000002';
update profiles set status = 'approved', role = 'staff'   where id = 'c7000000-0000-4000-8000-000000000003';
update profiles set status = 'approved', role = 'viewer'  where id = 'c7000000-0000-4000-8000-000000000004';

-- =====================================================================
-- 1. ADMIN (qua bot Content House): thêm chủ đề, tạo bài, phiên bản
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-mo-kenh":"content-house"}', true);
do $$
declare v_topic bigint; v_post bigint; ok boolean;
begin
  insert into content_topics (brand, topic, format) values ('house', 'TC Hồ bơi Nhà Biển lúc hoàng hôn', 'caption IG') returning id into v_topic;
  if (select created_by from content_topics where id = v_topic) is distinct from 'Duy Test (qua Content House)' then
    raise exception 'FAIL 1a: nhãn người tạo chủ đề sai (%)', (select created_by from content_topics where id = v_topic); end if;
  if (select status from content_topics where id = v_topic) <> 'cho' then raise exception 'FAIL 1b: chủ đề mới không ở trạng thái chờ'; end if;

  insert into content_posts (brand, topic_id) values ('house', v_topic) returning id into v_post;
  if (select status from content_posts where id = v_post) <> 'cho_viet' then raise exception 'FAIL 1c: bài mới không ở trạng thái cho_viet'; end if;

  insert into content_versions (post_id, version_no, body, engine) values (v_post, 1, 'Bản 1', 'claude');
  ok := false;
  begin insert into content_versions (post_id, version_no, body, engine) values (v_post, 1, 'Trùng số', 'claude');
  exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL 1d: tạo được 2 phiên bản cùng số'; end if;

  -- Mỗi khung giờ đúng một bài
  insert into content_slots (slot_date, brand, post_id) values ('2026-10-01', 'house', v_post);
  ok := false;
  begin insert into content_slots (slot_date, brand, post_id) values ('2026-10-01', 'house', v_post);
  exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL 1e: một khung giờ sinh được 2 bài'; end if;

  -- Giá trị ngoài danh sách bị chặn
  ok := false; begin insert into content_topics (brand, topic) values ('decor', 'x'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 1f: nhận thương hiệu ngoài house/bedding'; end if;
  ok := false; begin update content_posts set status = 'tu_dang' where id = v_post; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 1g: nhận trạng thái lạ'; end if;
  ok := false; begin update content_posts set published_url = 'javascript:alert(1)' where id = v_post; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 1h: nhận link đã đăng không phải http'; end if;
  ok := false; begin insert into content_topics (brand, topic) values ('bedding', '   '); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL 1i: nhận chủ đề rỗng'; end if;
end $$;
reset role;

-- =====================================================================
-- 2. QUẢN LÝ: chỉ đọc
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c7000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{}', true);
do $$
declare ok boolean; n int;
begin
  if not exists (select 1 from content_topics where topic like 'TC %') then raise exception 'FAIL 2a: quản lý không xem được hàng đợi'; end if;
  if not exists (select 1 from content_versions) then raise exception 'FAIL 2b: quản lý không xem được phiên bản'; end if;
  ok := false; begin insert into content_topics (brand, topic) values ('house', 'TC lén'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 2c: quản lý thêm được chủ đề'; end if;
  update content_posts set status = 'da_duyet' where true;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2d: quản lý duyệt được bài'; end if;
end $$;
reset role;

-- =====================================================================
-- 3. NHÂN VIÊN và CHỈ XEM: không thấy gì
-- =====================================================================
set local role authenticated;
do $$
declare u text;
begin
  foreach u in array array['c7000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000004'] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u), true);
    if exists (select 1 from content_topics) or exists (select 1 from content_posts)
       or exists (select 1 from content_versions) or exists (select 1 from content_slots) then
      raise exception 'FAIL 3a: % thấy dữ liệu content', u; end if;
    if can_view_content() then raise exception 'FAIL 3b: can_view_content() đúng với %', u; end if;
  end loop;
end $$;
reset role;

-- =====================================================================
-- 4. KHÁCH VÃNG LAI
-- =====================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare ok boolean; b text;
begin
  foreach b in array array['content_topics', 'content_posts', 'content_slots', 'content_versions'] loop
    ok := false;
    begin execute format('select 1 from public.%I limit 1', b); exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception 'FAIL 4a: anon đọc được %', b; end if;
  end loop;
  ok := false; begin perform can_view_content(); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL 4b: anon gọi được can_view_content()'; end if;
end $$;
reset role;

-- =====================================================================
-- 5. NHÃN TÁC NHÂN CỦA AGENT (quyền máy chủ) — và người dùng không giả danh được
-- =====================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('mo.tac_nhan', 'Content House (Claude)', true);
do $$
declare v bigint;
begin
  insert into content_topics (brand, topic) values ('house', 'TC từ máy chủ') returning id into v;
  if (select created_by from content_topics where id = v) is distinct from 'Content House (Claude)' then
    raise exception 'FAIL 5a: nhãn agent sai (%)', (select created_by from content_topics where id = v); end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{}', true);
select set_config('mo.tac_nhan', 'Content House (Claude)', true);   -- người dùng web tự khai: phải bị bỏ qua
do $$
declare v bigint;
begin
  insert into content_topics (brand, topic) values ('bedding', 'TC từ web') returning id into v;
  if (select created_by from content_topics where id = v) is distinct from 'Duy Test' then
    raise exception 'FAIL 5b: người dùng giả danh được agent (%)', (select created_by from content_topics where id = v); end if;
end $$;
reset role;

-- Nhãn Thư kí cũ vẫn đúng
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-mo-kenh":"thu-ki"}', true);
do $$ begin
  if actor_label() <> 'Duy Test (qua Thư kí)' then raise exception 'FAIL 5c: nhãn Thư kí bị hỏng (%)', actor_label(); end if;
end $$;
reset role;

select 'Bot Content — giai đoạn A: tất cả kiểm thử đã qua' as ket_qua;
rollback;
