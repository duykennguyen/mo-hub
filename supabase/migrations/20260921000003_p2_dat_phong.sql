-- =====================================================================
-- P2 — NHÀ & ĐẶT PHÒNG
-- Đơn vị cho thuê · khách · booking · lịch thu tiền · nhật ký booking
-- Chống trùng lịch thực thi ở tầng database (không lách được qua API).
--
-- Quyền: admin + quản lý được đặt phòng; chủ đầu tư (viewer) chỉ xem lịch và
-- số liệu, KHÔNG thấy SĐT/email/giấy tờ khách (Nghị định 13/2023).
-- Nhân viên (staff) không truy cập phần đặt phòng.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------- Bổ sung cho bảng nhà ----------
alter table public.properties
  add column kind           text,                    -- villa / toa_can_ho / dat_nen / mat_bang
  add column area_label     text,                    -- khu vực công khai: "Trà Quế", "An Bàng"…
  add column listing_type   text,                    -- cho_thue / chuyen_nhuong / ca_hai / khong
  add column is_published    boolean not null default false,
  add column public_title    text,
  add column public_summary  text,
  add column map_url         text;

-- ---------- Đơn vị cho thuê ----------
-- Villa nguyên căn = 1 đơn vị. Tòa căn hộ = nhiều đơn vị.
create table public.units (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.properties(id) on delete cascade,
  code            text not null,
  name            text not null,
  unit_type       text,                 -- nguyen_can / studio / 1pn / 2pn / penthouse
  bedrooms        int,
  max_guests      int,
  area_m2         numeric,
  list_rent_month bigint,               -- giá niêm yết theo tháng, VND
  list_rent_night bigint,
  note            text,
  active          boolean not null default true,
  is_published    boolean not null default false,
  sort            int not null default 100,
  created_at      timestamptz not null default now(),
  unique (property_id, code)
);
create index on public.units (property_id, sort);

-- ---------- Khách thuê (DỮ LIỆU CÁ NHÂN — chỉ admin/quản lý) ----------
create table public.guests (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text,
  email       text,
  nationality text,
  id_doc_type text,                     -- cccd / passport
  id_doc_no   text,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------- Booking ----------
create type public.booking_status as enum ('giu_cho','da_coc','dang_o','ket_thuc','huy');

create table public.bookings (
  id                bigint generated always as identity primary key,
  unit_id           uuid not null references public.units(id),
  guest_id          uuid references public.guests(id),
  start_date        date not null,
  end_date          date not null,      -- [start, end): end = ngày trả phòng, không tính đêm đó
  term_type         text not null default 'dai_han',   -- dai_han (theo tháng) / ngan_han (theo đêm)
  channel           text,               -- truc_tiep / moi_gioi / airbnb / booking / agoda / khac
  broker_name       text,
  commission_amount bigint,
  rent_amount       bigint,             -- dài hạn: tiền/tháng · ngắn hạn: tổng tiền
  deposit_amount    bigint,
  deposit_status    text default 'chua_nhan',  -- chua_nhan / da_nhan / da_hoan / khau_tru
  status            public.booking_status not null default 'giu_cho',
  contract_url      text,               -- link Drive, không upload hợp đồng lên repo
  note              text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (end_date > start_date)
);
create index on public.bookings (unit_id, start_date);
create index on public.bookings (status, deleted_at);

-- CHỐNG TRÙNG LỊCH: không thể có 2 booking còn hiệu lực chồng ngày trên cùng đơn vị
alter table public.bookings add constraint bookings_khong_trung_lich
  exclude using gist (
    unit_id with =,
    daterange(start_date, end_date, '[)') with &&
  ) where (status <> 'huy' and deleted_at is null);

-- ---------- Lịch thu tiền ----------
create table public.payments (
  id           bigint generated always as identity primary key,
  booking_id   bigint not null references public.bookings(id) on delete cascade,
  kind         text not null default 'tien_thue',  -- tien_thue / tien_coc / dien_nuoc / phi_khac / hoan_coc
  period_label text,                               -- "T10/2026"
  amount_due   bigint not null default 0,
  amount_paid  bigint not null default 0,
  due_date     date,
  paid_date    date,
  method       text,                               -- tien_mat / chuyen_khoan / khac
  note         text,
  created_at   timestamptz not null default now()
);
create index on public.payments (booking_id, due_date);

-- ---------- Nhật ký booking (cùng mẫu với task_log) ----------
create table public.booking_log (
  id         bigint generated always as identity primary key,
  booking_id bigint not null,
  action     text not null,          -- tao / sua / huy / xoa / khoi_phuc
  changes    jsonb,
  actor      text,
  at         timestamptz not null default now()
);
create index on public.booking_log (booking_id, at desc);

-- =====================================================================
-- HÀM PHÂN QUYỀN
-- =====================================================================
create or replace function public.can_book() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','manager'), false)
$$;

create or replace function public.can_view_booking() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','manager','viewer'), false)
$$;

-- =====================================================================
-- TRIGGER
-- =====================================================================
-- Tự điền người tạo, chặn người không phải admin xóa/khôi phục
create or replace function public.bookings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor_label());
  else
    if new.deleted_at is distinct from old.deleted_at
       and auth.uid() is not null and not is_admin() then
      raise exception 'Chỉ quản trị viên được xóa hoặc khôi phục booking';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger bookings_guard before insert or update on public.bookings
for each row execute function public.bookings_guard();

create or replace function public.log_booking_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_diff jsonb := '{}'; v_key text; v_act text;
begin
  if tg_op = 'INSERT' then
    insert into booking_log (booking_id, action, changes, actor)
    values (new.id, 'tao', jsonb_build_object('unit_id', new.unit_id,
            'start_date', new.start_date, 'end_date', new.end_date), actor_label());
    return new;
  end if;
  for v_key in select jsonb_object_keys(to_jsonb(new)) loop
    if v_key <> 'updated_at'
       and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
      v_diff := v_diff || jsonb_build_object(v_key,
                jsonb_build_object('cu', to_jsonb(old) -> v_key, 'moi', to_jsonb(new) -> v_key));
    end if;
  end loop;
  if v_diff = '{}' then return new; end if;
  v_act := case
    when new.deleted_at is not null and old.deleted_at is null then 'xoa'
    when new.deleted_at is null and old.deleted_at is not null then 'khoi_phuc'
    when new.status = 'huy' and old.status <> 'huy' then 'huy'
    else 'sua' end;
  insert into booking_log (booking_id, action, changes, actor) values (new.id, v_act, v_diff, actor_label());
  return new;
end $$;
create trigger bookings_log after insert or update on public.bookings
for each row execute function public.log_booking_change();

-- =====================================================================
-- LỊCH THU TIỀN THEO THÁNG
-- Gọi khi booking dài hạn đã chốt. Chạy lại được: xóa dòng tiền thuê chưa thu rồi tạo lại.
-- =====================================================================
create or replace function public.generate_rent_schedule(p_booking bigint) returns int
language plpgsql security definer set search_path = public as $$
declare b record; v_ngay date; v_so int := 0;
begin
  select * into b from bookings where id = p_booking and deleted_at is null;
  if b is null then raise exception 'Không tìm thấy booking #%', p_booking; end if;
  if not can_book() and auth.uid() is not null then
    raise exception 'Bạn không có quyền tạo lịch thu tiền';
  end if;
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

-- Chuyển trạng thái theo ngày (gọi hằng ngày; P4 sẽ gắn pg_cron)
create or replace function public.cap_nhat_trang_thai_booking() returns int
language plpgsql security definer set search_path = public as $$
declare v_so int := 0; v_hom_nay date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  update bookings set status = 'dang_o'
   where status = 'da_coc' and deleted_at is null and start_date <= v_hom_nay and end_date > v_hom_nay;
  get diagnostics v_so = row_count;
  update bookings set status = 'ket_thuc'
   where status in ('da_coc','dang_o') and deleted_at is null and end_date <= v_hom_nay;
  return v_so;
end $$;

-- =====================================================================
-- PHÂN QUYỀN (RLS)
-- =====================================================================
alter table public.units       enable row level security;
alter table public.guests      enable row level security;
alter table public.bookings    enable row level security;
alter table public.payments    enable row level security;
alter table public.booking_log enable row level security;

-- Đơn vị: thành viên đã duyệt xem được (vẫn theo giới hạn nhà ở mục 5.3); admin sửa
create policy "units: xem" on public.units for select
  using (can_read() and (not is_restricted() or property_id in (select my_properties())));
create policy "units: ghi" on public.units for all
  using (is_admin()) with check (is_admin());

-- Khách: chỉ admin và quản lý (dữ liệu cá nhân)
create policy "guests: đọc ghi" on public.guests for all
  using (can_book()) with check (can_book());

-- Booking: admin/quản lý đọc ghi; chủ đầu tư xem qua view bookings_viewer (không có PII)
create policy "bookings: xem" on public.bookings for select
  using (can_book() and (deleted_at is null or is_admin()));
create policy "bookings: thêm" on public.bookings for insert with check (can_book());
create policy "bookings: sửa"  on public.bookings for update
  using (can_book() and (deleted_at is null or is_admin())) with check (can_book());
create policy "bookings: xóa"  on public.bookings for delete using (is_admin());

create policy "payments: xem"    on public.payments for select using (can_view_booking());
create policy "payments: ghi"    on public.payments for all    using (can_book()) with check (can_book());
create policy "booking_log: xem" on public.booking_log for select using (can_view_booking());

-- Chủ đầu tư: lịch thuê không kèm số điện thoại, email, giấy tờ khách
create view public.bookings_viewer as
  select b.id, b.unit_id, b.start_date, b.end_date, b.term_type, b.status,
         b.rent_amount, b.deposit_amount, b.deposit_status, b.channel,
         g.full_name as guest_name
    from public.bookings b
    left join public.guests g on g.id = b.guest_id
   where b.deleted_at is null and can_view_booking();
revoke all on public.bookings_viewer from anon;   -- khách vãng lai không đụng tới view này
grant select on public.bookings_viewer to authenticated;

-- =====================================================================
-- VIEW CÔNG KHAI (trang Mô House đọc ở P3) — chỉ liệt kê cột được phép công khai
-- =====================================================================
create view public.public_properties as
  select id, code, coalesce(public_title, name) as title, public_summary,
         area_label, kind, listing_type, map_url, sort
    from public.properties
   where is_published and active;

create view public.public_units as
  select u.id, u.property_id, u.name, u.unit_type, u.bedrooms, u.max_guests,
         u.area_m2, u.list_rent_month, u.list_rent_night, u.sort
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.is_published and u.active and p.is_published and p.active;

-- Chỉ ngày bận/trống. KHÔNG tên khách, KHÔNG giá thực thu.
create view public.public_availability as
  select b.unit_id, b.start_date, b.end_date
    from public.bookings b
   where b.status in ('giu_cho','da_coc','dang_o') and b.deleted_at is null
     and b.unit_id in (select id from public.public_units);

grant select on public.public_properties, public.public_units, public.public_availability to anon, authenticated;
