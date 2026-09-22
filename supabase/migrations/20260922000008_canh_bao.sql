-- =====================================================================
-- P2 — CẢNH BÁO TỰ ĐỘNG + VÁ RÒ RỈ SỐ ĐIỆN THOẠI KHÁCH
--
-- 1) Cảnh báo (CLAUDE.md mục 6.2): hợp đồng hết hạn còn 30/15/7 ngày,
--    khoản thu quá hạn, cọc chưa hoàn sau khi khách đã trả phòng.
--    Mỗi cảnh báo sinh ra MỘT việc loại quan_ly, không bao giờ trùng —
--    chống trùng bằng cột `tasks.alert_key` có chỉ mục duy nhất.
--
-- 2) `bao_cao_ngay()` đang trả số điện thoại khách cho cả vai trò "chỉ xem"
--    (chủ đầu tư). Mục 5.2 nói chủ đầu tư KHÔNG được thấy SĐT/giấy tờ khách.
--    Sửa: chỉ kèm SĐT khi người gọi là máy chủ (Thư kí) hoặc có quyền đặt phòng.
--
-- CỐ Ý KHÔNG ghi số tiền vào tiêu đề/chi tiết việc: việc hiện cho cả nhân viên
-- buồng phòng của nhà đó, còn số tiền thuộc nhóm dữ liệu kinh doanh (mục 9.6).
-- =====================================================================

-- ---------- Khóa chống trùng cảnh báo ----------
alter table public.tasks add column if not exists alert_key text;
comment on column public.tasks.alert_key is
  'Khóa của cảnh báo tự động, ví dụ hd30:12 (hợp đồng còn 30 ngày của booking 12). Việc do người tạo thì để trống.';
create unique index if not exists tasks_alert_key_uniq on public.tasks (alert_key) where alert_key is not null;

-- ---------- Sinh cảnh báo ----------
create or replace function public.tao_canh_bao() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_hom_nay date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_so int := 0;
  v_them int;
begin
  if not (la_may_chu() or is_admin()) then
    raise exception 'Chỉ quản trị viên hoặc lịch tự động mới tạo được cảnh báo';
  end if;

  -- 1) Hợp đồng sắp hết hạn: nhắc ở 3 mốc, mốc 7 ngày là việc gấp
  with moc(ngay, muc) as (
    values (30, 'thuong'::public.task_priority), (15, 'thuong'), (7, 'cao')
  )
  insert into public.tasks (property_id, title, detail, category, priority, due_date, source, created_by, alert_key)
  select u.property_id,
         'Hợp đồng căn ' || u.name || ' còn ' || m.ngay || ' ngày',
         'Khách ' || coalesce(g.full_name, '(chưa ghi tên)') ||
           ' trả phòng ngày ' || to_char(b.end_date, 'DD/MM/YYYY') ||
           '. Hỏi khách gia hạn hay chốt ngày dọn và hoàn cọc.',
         'quan_ly', m.muc, v_hom_nay, 'canh_bao', 'Cảnh báo tự động',
         'hd' || m.ngay || ':' || b.id
    from public.bookings b
    join public.units u on u.id = b.unit_id
    left join public.guests g on g.id = b.guest_id
    cross join moc m
   where b.deleted_at is null and b.status in ('da_coc', 'dang_o')
     and b.end_date = v_hom_nay + m.ngay
  on conflict do nothing;          -- đã nhắc mốc này rồi thì thôi (chỉ mục tasks_alert_key_uniq)
  get diagnostics v_them = row_count; v_so := v_so + v_them;

  -- 2) Khoản thu quá hạn — mỗi dòng lịch thu một việc
  insert into public.tasks (property_id, title, detail, category, priority, due_date, source, created_by, alert_key)
  select u.property_id,
         'Thu tiền quá hạn — căn ' || u.name || coalesce(' · ' || pm.period_label, ''),
         'Khách ' || coalesce(g.full_name, '(chưa ghi tên)') ||
           '. Hạn thu ' || to_char(pm.due_date, 'DD/MM/YYYY') ||
           '. Xem số tiền và đánh dấu đã thu trong lịch đặt phòng.',
         'quan_ly', 'cao', v_hom_nay, 'canh_bao', 'Cảnh báo tự động',
         'thu:' || pm.id
    from public.payments pm
    join public.bookings b on b.id = pm.booking_id
    join public.units u on u.id = b.unit_id
    left join public.guests g on g.id = b.guest_id
   where b.deleted_at is null
     and pm.amount_paid < pm.amount_due
     and pm.due_date < v_hom_nay
  on conflict do nothing;
  get diagnostics v_them = row_count; v_so := v_so + v_them;

  -- 3) Cọc chưa hoàn sau khi khách đã trả phòng (chỉ xét 90 ngày gần đây)
  insert into public.tasks (property_id, title, detail, category, priority, due_date, source, created_by, alert_key)
  select u.property_id,
         'Hoàn cọc cho khách ' || coalesce(g.full_name, '(chưa ghi tên)') || ' — căn ' || u.name,
         'Khách đã trả phòng ngày ' || to_char(b.end_date, 'DD/MM/YYYY') ||
           ' nhưng tiền cọc vẫn ở trạng thái đã nhận. Hoàn cọc hoặc ghi rõ phần khấu trừ.',
         'quan_ly', 'thuong', v_hom_nay, 'canh_bao', 'Cảnh báo tự động',
         'coc:' || b.id
    from public.bookings b
    join public.units u on u.id = b.unit_id
    left join public.guests g on g.id = b.guest_id
   where b.deleted_at is null and b.status = 'ket_thuc'
     and b.deposit_status = 'da_nhan'
     and b.end_date < v_hom_nay and b.end_date >= v_hom_nay - 90
  on conflict do nothing;
  get diagnostics v_them = row_count; v_so := v_so + v_them;

  return v_so;
end $$;

comment on function public.tao_canh_bao() is
  'Sinh việc nhắc: hợp đồng còn 30/15/7 ngày, khoản thu quá hạn, cọc chưa hoàn. Chạy hằng ngày bằng pg_cron.';

revoke all on function public.tao_canh_bao() from public, anon;
grant execute on function public.tao_canh_bao() to authenticated, service_role;

-- ---------- Vá: chỉ người được đặt phòng mới thấy số điện thoại khách ----------
create or replace function public.bao_cao_ngay(p_ngay date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ngay date := coalesce(p_ngay, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_mai  date := v_ngay + 1;
  v_pii  boolean := la_may_chu() or can_book();   -- chủ đầu tư (viewer) không thuộc nhóm này
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
          'sdt', case when v_pii then g.phone else null end,
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

revoke all on function public.bao_cao_ngay(date) from public, anon;
grant execute on function public.bao_cao_ngay(date) to authenticated, service_role;
