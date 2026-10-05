-- Ẩn giá chào bán khỏi site công khai Mô House · Chuyển nhượng (quyết định của chủ dự án 05/10/2026):
-- khách thấy "Liên hệ", giá chỉ còn trong bảng gốc sale_listings (admin xem ở ban.html).
-- price_note cũng ẩn theo, vì nó ghi giá/m² hoặc lợi suất — từ đó suy ngược ra giá.
-- Giữ nguyên tên và kiểu cột (trả null) để bản site.js cũ còn trong cache trình duyệt không bị lỗi.

create or replace view public.public_sale_listings as
  select s.slug, s.title, s.tagline, s.area_label, s.kind_label, s.land_area_m2, s.floor_area_m2,
         null::bigint as asking_price, null::text as price_note,
         s.summary, s.highlights, s.facts, s.sections, s.cash_flow,
         s.legal_public, s.risks, s.cover_url, s.photos, s.map_url, s.sort, s.updated_at
    from public.sale_listings s
    join public.properties p on p.id = s.property_id
   where s.is_published and p.active;
grant select on public.public_sale_listings to anon, authenticated;

-- Ghi chú dòng tiền của Mô Xanh từng nhắc giá chào: viết lại không có giá
update public.sale_listings
   set cash_flow = jsonb_set(cash_flow, '{ghi_chu}',
         to_jsonb('Số liệu dự kiến theo phương án xây dựng, chỉ để tham khảo đầu tư; giá bán là giá đất trống, chưa gồm chi phí xây dựng.'::text))
 where slug = 'mo-xanh' and cash_flow ? 'ghi_chu';
