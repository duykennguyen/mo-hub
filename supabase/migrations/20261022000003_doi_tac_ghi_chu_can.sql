-- Trang Gửi đối tác: dòng ghi chú ngắn cho từng căn (tầng, số phòng ngủ, điểm nổi bật…).
-- Nội dung do admin tự nhập trên trang, không điền sẵn.
alter table public.partner_units add column subtitle text;

create or replace view public.public_partner_units as
  select p.code as house_code, h.title as house_title, h.sort as house_sort,
         u.id as unit_id, pu.title as unit_title, pu.sort as unit_sort,
         pu.link_chi_tiet, pu.link_anh, pu.link_dai_han, pu.link_ngan_han,
         h.subtitle as house_subtitle, pu.subtitle as unit_subtitle
    from public.partner_units pu
    join public.units u          on u.id = pu.unit_id
    join public.partner_houses h on h.property_id = u.property_id
    join public.properties p     on p.id = u.property_id
   where pu.published and h.published and u.active and p.active;
