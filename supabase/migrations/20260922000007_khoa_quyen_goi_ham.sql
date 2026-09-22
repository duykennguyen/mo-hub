-- =====================================================================
-- VÁ LỖ HỔNG: khóa quyền gọi các hàm security definer
--
-- Phát hiện 22/09/2026 khi thử gọi API bằng khóa công khai (khóa này nằm sẵn
-- trong config.js của web, ai cũng đọc được):
--   · bao_cao_ngay()                 → TRẢ VỀ TÊN VÀ SỐ ĐIỆN THOẠI KHÁCH
--   · cap_nhat_trang_thai_booking()  → chạy được, đổi trạng thái booking
--   · don_nhap_booking_cu()          → chạy được, xóa bản nháp
--   · generate_rent_schedule(id)     → lọt qua cửa kiểm quyền, sửa được lịch thu tiền
--
-- Nguyên nhân: hàm security definer mặc định cho PUBLIC gọi, và điều kiện kiểm
-- quyền viết kiểu "auth.uid() is not null and not can_...()" — người chưa đăng nhập
-- có auth.uid() rỗng nên né được luôn cửa kiểm.
--
-- Cách sửa: kiểm quyền theo hướng CHO PHÉP (allowlist) thay vì loại trừ,
-- cộng thêm thu hồi quyền EXECUTE của anon.
-- =====================================================================

-- Người gọi có phải máy chủ không: Thư kí (service role), pg_cron, hay SQL Editor
-- CHÚ Ý: không dùng current_user ở đây. Trong hàm security definer, current_user là
-- CHỦ SỞ HỮU hàm (postgres) chứ không phải người gọi → kiểm kiểu đó luôn đúng, vô dụng.
-- PostgREST gọi SET ROLE anon/authenticated/service_role nên biến "role" mới là người gọi thật.
create or replace function public.la_may_chu() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      or coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'supabase_admin', 'service_role')
$$;

-- ---------- Báo cáo ngày: chỉ máy chủ hoặc người có quyền xem đặt phòng ----------
create or replace function public.bao_cao_ngay(p_ngay date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ngay date := coalesce(p_ngay, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_mai  date := v_ngay + 1;
  v_kq   jsonb;
begin
  if not (la_may_chu() or can_view_booking()) then
    raise exception 'Bạn không có quyền xem báo cáo đặt phòng';
  end if;

  select jsonb_build_object(
    'ngay', v_ngay,
    'nhan_phong', coalesce((
      select jsonb_agg(d order by d->>'can')
      from (
        select jsonb_build_object(
          'id', b.id, 'can', u.name, 'nha', p.name,
          'khach', coalesce(g.full_name, '(chưa ghi tên)'),
          'sdt', g.phone,
          'den_ngay', b.end_date, 'kieu', b.term_type, 'trang_thai', b.status,
          'kenh', b.channel
        ) as d
        from bookings b
        join units u on u.id = b.unit_id
        join properties p on p.id = u.property_id
        left join guests g on g.id = b.guest_id
        where b.deleted_at is null and b.status <> 'huy' and b.start_date = v_ngay
      ) t), '[]'::jsonb),

    'tra_phong', coalesce((
      select jsonb_agg(d order by d->>'can')
      from (
        select jsonb_build_object(
          'id', b.id, 'can', u.name, 'nha', p.name,
          'khach', coalesce(g.full_name, '(chưa ghi tên)'),
          'tu_ngay', b.start_date, 'kieu', b.term_type,
          'coc', b.deposit_amount, 'trang_thai_coc', b.deposit_status
        ) as d
        from bookings b
        join units u on u.id = b.unit_id
        join properties p on p.id = u.property_id
        left join guests g on g.id = b.guest_id
        where b.deleted_at is null and b.status <> 'huy' and b.end_date = v_ngay
      ) t), '[]'::jsonb),

    'dang_o', coalesce((
      select jsonb_agg(d order by d->>'can')
      from (
        select jsonb_build_object(
          'id', b.id, 'can', u.name, 'nha', p.name,
          'khach', coalesce(g.full_name, '(chưa ghi tên)'),
          'den_ngay', b.end_date,
          'con_lai', (b.end_date - v_ngay)
        ) as d
        from bookings b
        join units u on u.id = b.unit_id
        join properties p on p.id = u.property_id
        left join guests g on g.id = b.guest_id
        where b.deleted_at is null and b.status <> 'huy'
          and b.start_date < v_ngay and b.end_date > v_ngay
      ) t), '[]'::jsonb),

    'mai_nhan', coalesce((
      select jsonb_agg(d order by d->>'can')
      from (
        select jsonb_build_object(
          'id', b.id, 'can', u.name, 'nha', p.name,
          'khach', coalesce(g.full_name, '(chưa ghi tên)'),
          'den_ngay', b.end_date, 'trang_thai', b.status
        ) as d
        from bookings b
        join units u on u.id = b.unit_id
        join properties p on p.id = u.property_id
        left join guests g on g.id = b.guest_id
        where b.deleted_at is null and b.status <> 'huy' and b.start_date = v_mai
      ) t), '[]'::jsonb),

    'con_trong', coalesce((
      select jsonb_agg(u.name order by u.name)
      from units u
      where u.active and not exists (
        select 1 from bookings b
        where b.unit_id = u.id and b.deleted_at is null and b.status <> 'huy'
          and b.start_date <= v_ngay and b.end_date > v_ngay)
    ), '[]'::jsonb),

    'qua_han', coalesce((
      select jsonb_build_object('so_khoan', count(*), 'tong', coalesce(sum(pm.amount_due - pm.amount_paid), 0))
      from payments pm join bookings b on b.id = pm.booking_id
      where b.deleted_at is null and pm.amount_paid < pm.amount_due and pm.due_date < v_ngay
    ), '{}'::jsonb),

    'sap_het_han', coalesce((
      select jsonb_agg(d order by d->>'den_ngay')
      from (
        select jsonb_build_object('can', u.name, 'khach', coalesce(g.full_name, '(chưa ghi tên)'),
                                  'den_ngay', b.end_date) as d
        from bookings b
        join units u on u.id = b.unit_id
        left join guests g on g.id = b.guest_id
        where b.deleted_at is null and b.status in ('da_coc', 'dang_o')
          and b.end_date > v_ngay and b.end_date <= v_ngay + 7
      ) t), '[]'::jsonb)
  ) into v_kq;

  return v_kq;
end $$;

-- ---------- Lịch thu tiền: chỉ máy chủ hoặc người được đặt phòng ----------
create or replace function public.generate_rent_schedule(p_booking bigint) returns int
language plpgsql security definer set search_path = public as $$
declare b record; v_ngay date; v_so int := 0;
begin
  if not (la_may_chu() or can_book()) then
    raise exception 'Bạn không có quyền tạo lịch thu tiền';
  end if;

  select * into b from bookings where id = p_booking and deleted_at is null;
  if b is null then raise exception 'Không tìm thấy booking #%', p_booking; end if;
  if b.term_type <> 'dai_han' then
    raise exception 'Chỉ tạo lịch thu theo tháng cho booking dài hạn';
  end if;

  delete from payments where booking_id = p_booking and kind = 'tien_thue' and amount_paid = 0;

  v_ngay := b.start_date;
  while v_ngay < b.end_date loop
    insert into payments (booking_id, kind, period_label, amount_due, due_date)
    values (p_booking, 'tien_thue',
            'T' || to_char(v_ngay, 'MM/YYYY'), coalesce(b.rent_amount, 0), v_ngay);
    v_so := v_so + 1;
    v_ngay := (v_ngay + interval '1 month')::date;
  end loop;
  return v_so;
end $$;

-- ---------- Hai hàm chỉ dành cho máy chủ ----------
create or replace function public.cap_nhat_trang_thai_booking() returns int
language plpgsql security definer set search_path = public as $$
declare v_so int := 0; v_hom_nay date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not (la_may_chu() or is_admin()) then
    raise exception 'Chỉ quản trị viên hoặc lịch tự động mới chạy được hàm này';
  end if;
  update bookings set status = 'dang_o'
   where status = 'da_coc' and deleted_at is null and start_date <= v_hom_nay and end_date > v_hom_nay;
  get diagnostics v_so = row_count;
  update bookings set status = 'ket_thuc'
   where status in ('da_coc','dang_o') and deleted_at is null and end_date <= v_hom_nay;
  return v_so;
end $$;

create or replace function public.don_nhap_booking_cu() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not la_may_chu() then raise exception 'Hàm này chỉ chạy tự động trên máy chủ'; end if;
  delete from bot_booking_drafts where created_at < now() - interval '1 day';
end $$;

-- ---------- Thu hồi quyền gọi của khách vãng lai ----------
revoke all on function public.bao_cao_ngay(date)               from public, anon;
revoke all on function public.generate_rent_schedule(bigint)   from public, anon;
revoke all on function public.cap_nhat_trang_thai_booking()    from public, anon;
revoke all on function public.don_nhap_booking_cu()            from public, anon, authenticated;
revoke all on function public.la_may_chu()                     from public, anon;

grant execute on function public.bao_cao_ngay(date)             to authenticated, service_role;
grant execute on function public.generate_rent_schedule(bigint) to authenticated, service_role;
grant execute on function public.cap_nhat_trang_thai_booking()  to authenticated, service_role;
grant execute on function public.don_nhap_booking_cu()          to service_role;
grant execute on function public.la_may_chu()                   to authenticated, service_role;
