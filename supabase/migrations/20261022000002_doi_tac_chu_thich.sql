-- Trang Gửi đối tác: thêm dòng chú thích nhỏ dưới tên nhà (số căn, khu vực).
alter table public.partner_houses add column subtitle text;

-- Thêm cột mới ở cuối view (create or replace chỉ cho thêm cột phía sau)
create or replace view public.public_partner_units as
  select p.code as house_code, h.title as house_title, h.sort as house_sort,
         u.id as unit_id, pu.title as unit_title, pu.sort as unit_sort,
         pu.link_chi_tiet, pu.link_anh, pu.link_dai_han, pu.link_ngan_han,
         h.subtitle as house_subtitle
    from public.partner_units pu
    join public.units u          on u.id = pu.unit_id
    join public.partner_houses h on h.property_id = u.property_id
    join public.properties p     on p.id = u.property_id
   where pu.published and h.published and u.active and p.active;

-- Tên và chú thích do chủ dự án đặt (22/10/2026)
update public.partner_houses h set title = v.title, subtitle = v.sub
  from (values ('CAMF', 'CamFusion House', '6 apartments - An Mỹ'),
               ('TRAU', 'Trầu House', '2 apartments - An Mỹ'),
               ('BIEN', 'Beach Oasis Villa', 'Nguyên căn - An Bàng'),
               ('SEN',  'Sen Villa', 'Nguyên căn - Trà Quế')) v(code, title, sub)
  join public.properties p on p.code = v.code
 where h.property_id = p.id;
