-- =====================================================================
-- TRANG "GỬI ĐỐI TÁC" (doi-tac.html) — một link tổng gửi sale/môi giới.
-- Cấp 1: danh sách nhà → Cấp 2: các căn → Cấp 3: 4 nút mở link Drive
-- (Chi tiết căn · Ảnh phòng · Thuê dài hạn · Thuê ngắn hạn).
-- Ai cũng xem được qua view public_partner_units; chỉ admin sửa.
-- =====================================================================

create table public.partner_houses (
  property_id uuid primary key references public.properties(id) on delete cascade,
  title       text not null,              -- tên hiện cho đối tác, ví dụ "CamFusion"
  sort        int  not null default 0,
  published   boolean not null default true
);

create table public.partner_units (
  unit_id       uuid primary key references public.units(id) on delete cascade,
  title         text not null,            -- tên căn hiện cho đối tác
  sort          int  not null default 0,
  published     boolean not null default true,
  link_chi_tiet text,
  link_anh      text,
  link_dai_han  text,
  link_ngan_han text,
  -- Chỉ nhận link https để không chèn được javascript: hay link lạ vào trang công khai
  constraint partner_units_link_https check (
        (link_chi_tiet is null or link_chi_tiet ~ '^https://\S+$')
    and (link_anh      is null or link_anh      ~ '^https://\S+$')
    and (link_dai_han  is null or link_dai_han  ~ '^https://\S+$')
    and (link_ngan_han is null or link_ngan_han ~ '^https://\S+$'))
);

alter table public.partner_houses enable row level security;
alter table public.partner_units  enable row level security;
create policy "partner_houses: xem" on public.partner_houses for select using (can_read());
create policy "partner_houses: ghi" on public.partner_houses for all using (is_admin()) with check (is_admin());
create policy "partner_units: xem"  on public.partner_units  for select using (can_read());
create policy "partner_units: ghi"  on public.partner_units  for all using (is_admin()) with check (is_admin());

-- Bản xuất công khai: chỉ tên nhà, tên căn, link. Không giá, không khách.
create view public.public_partner_units as
  select p.code as house_code, h.title as house_title, h.sort as house_sort,
         u.id as unit_id, pu.title as unit_title, pu.sort as unit_sort,
         pu.link_chi_tiet, pu.link_anh, pu.link_dai_han, pu.link_ngan_han
    from public.partner_units pu
    join public.units u          on u.id = pu.unit_id
    join public.partner_houses h on h.property_id = u.property_id
    join public.properties p     on p.id = u.property_id
   where pu.published and h.published and u.active and p.active;
grant select on public.public_partner_units to anon, authenticated;

-- Nạp sẵn 4 nhà đang cho thuê (đúng thứ tự chủ dự án đưa). Nhà nào chưa có trong database thì bỏ qua.
insert into public.partner_houses (property_id, title, sort)
select p.id, v.title, v.sort
  from (values ('CAMF', 'CamFusion', 1), ('TRAU', 'Trầu', 2),
               ('BIEN', 'An Bang Beach Oasis', 3), ('SEN', 'Sen', 4)) v(code, title, sort)
  join public.properties p on p.code = v.code
on conflict do nothing;

insert into public.partner_units (unit_id, title, sort)
select u.id, case when u.code = 'NGUYENCAN' then 'Nguyên căn' else u.name end, coalesce(u.sort, 0)
  from public.units u join public.partner_houses h on h.property_id = u.property_id
 where u.active
on conflict do nothing;
