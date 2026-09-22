-- =====================================================================
-- THƯ KÍ + ĐẶT PHÒNG
-- 1) Bảng nháp booking: Thư kí đọc tin nhắn xong giữ tạm ở đây, chờ bấm nút xác nhận.
-- 2) Hàm bao_cao_ngay(): số liệu cho tin nhắn 08:00 sáng và cho khối "Hôm nay" trên web.
-- =====================================================================

-- ---------- Nháp booking đang chờ xác nhận ----------
create table public.bot_booking_drafts (
  id         bigint generated always as identity primary key,
  text       text not null,          -- nguyên văn tin nhắn, để đọc lại khi cần
  payload    jsonb not null,         -- kết quả bộ đọc: dòng bookings + tên khách
  created_at timestamptz not null default now()
);
alter table public.bot_booking_drafts enable row level security;   -- không policy: chỉ Thư kí (service role) dùng

-- Dọn nháp cũ hơn 1 ngày để bảng không phình
create or replace function public.don_nhap_booking_cu() returns void
language sql security definer set search_path = public as $$
  delete from bot_booking_drafts where created_at < now() - interval '1 day'
$$;

-- =====================================================================
-- BÁO CÁO NGÀY
-- Trả về JSON để Thư kí soạn tin và web hiện khối "Hôm nay".
-- Ngày làm việc tính theo giờ Việt Nam.
-- =====================================================================
create or replace function public.bao_cao_ngay(p_ngay date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ngay date := coalesce(p_ngay, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_mai  date := v_ngay + 1;
  v_kq   jsonb;
begin
  -- Gọi từ web thì phải có quyền xem đặt phòng; gọi từ Thư kí (service role) thì auth.uid() rỗng
  if auth.uid() is not null and not can_view_booking() then
    raise exception 'Bạn không có quyền xem báo cáo đặt phòng';
  end if;

  select jsonb_build_object(
    'ngay', v_ngay,
    -- Khách nhận phòng hôm nay
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

    -- Khách trả phòng hôm nay
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

    -- Đang ở (đã nhận phòng trước hôm nay, chưa tới ngày trả)
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

    -- Ngày mai nhận phòng
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

    -- Căn còn trống hôm nay (không có ai ở, không ai nhận phòng)
    'con_trong', coalesce((
      select jsonb_agg(u.name order by u.name)
      from units u
      where u.active and not exists (
        select 1 from bookings b
        where b.unit_id = u.id and b.deleted_at is null and b.status <> 'huy'
          and b.start_date <= v_ngay and b.end_date > v_ngay)
    ), '[]'::jsonb),

    -- Cần chú ý: khoản thu quá hạn và hợp đồng sắp hết hạn trong 7 ngày
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

comment on function public.bao_cao_ngay(date) is
  'Số liệu lịch trong ngày: nhận phòng, trả phòng, đang ở, mai nhận, căn trống, khoản quá hạn, hợp đồng sắp hết hạn.';
