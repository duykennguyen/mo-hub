-- Bot Content: mỗi lần viết ra 3 phương án (3 phong cách) để Duy chọn một.
-- content_versions.options = [{"so":1,"phong_cach":"…","body":"…"}, …]; body vẫn giữ toàn văn (cả 3 phương án).
-- content_posts.chosen_option = phương án Duy bấm "Chọn" khi duyệt.

alter table public.content_versions add column if not exists options jsonb
  check (options is null or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 1 and 3));
alter table public.content_posts add column if not exists chosen_option smallint
  check (chosen_option between 1 and 3);

-- Nộp bài: thêm tham số p_options (mặc định null để lời gọi cũ vẫn chạy)
drop function if exists public.content_nop_bai(bigint, text, text, text);
create or replace function public.content_nop_bai(p_post bigint, p_ai text, p_body text, p_engine text,
                                                  p_options jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare p public.content_posts%rowtype; v_no int;
begin
  if not la_may_chu() then raise exception 'Chỉ máy chủ nộp bài'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'Bài rỗng'; end if;
  select * into p from content_posts where id = p_post for update;
  if not found or p.status <> 'dang_viet' or p.claimed_by is distinct from p_ai then
    raise exception 'Bộ máy % không giữ bài #% (có thể đã hết hạn khóa)', p_ai, p_post;
  end if;
  perform set_config('mo.tac_nhan', content_ten_agent(p.brand, p_engine), true);
  v_no := p.current_version + 1;
  insert into content_versions (post_id, version_no, body, feedback_before, engine, options)
  values (p_post, v_no, p_body, p.feedback_pending, p_engine, p_options);
  update content_posts set current_version = v_no, status = 'cho_duyet', feedback_pending = null,
         engine = p_engine, claimed_by = null, claimed_at = null, chosen_option = null
   where id = p_post;
  return content_goi_viec(p_post, 'da_nop')
      || jsonb_build_object('phien_ban', v_no, 'engine', p_engine, 'body', p_body, 'options', p_options);
end $$;

revoke all on function public.content_nop_bai(bigint, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.content_nop_bai(bigint, text, text, text, jsonb) to service_role;
