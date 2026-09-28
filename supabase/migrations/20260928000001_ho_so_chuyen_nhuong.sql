-- =====================================================================
-- CHẶNG 2 — HỒ SƠ CHUYỂN NHƯỢNG (Mô House · Bán) + AGENT HỒ SƠ (agent số 2)
--
-- sale_listings    : nội dung hồ sơ bán của từng tài sản — phần ĐƯỢC PHÉP công khai
--                    (quyết định của chủ dự án 28/09/2026: trang bán công khai, có hiện giá chào).
-- property_private : phần CHỈ ADMIN — số giấy chứng nhận, số thửa, cơ quan cấp, mandate bán.
-- public_sale_listings : view cho site Mô House · Bán (anon), chỉ liệt kê cột công khai.
--
-- Agent Hồ sơ (loại A, chạy trong database):
--   · trigger chặn xuất bản khi thiếu giá, pháp lý, điểm cần lưu ý, hoặc chưa xác nhận mandate bán
--     (Quy chuẩn Profile BĐS Mô House v1.0, CLAUDE.md mục 6.3);
--   · ho_so_ban_diem(): chấm % hồ sơ từng tài sản, liệt kê còn thiếu gì.
-- Dữ liệu thật KHÔNG nằm trong migration: admin nạp qua nhap_tai_san_ban() trên Mô Hub.
-- =====================================================================

create table public.sale_listings (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null unique references public.properties(id) on delete cascade,
  slug           text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title          text not null,
  tagline        text,
  area_label     text,                         -- vị trí hiển thị công khai: "An Bàng · Hội An Tây"
  kind_label     text,                         -- "Villa hồ bơi", "Đất nền"…
  land_area_m2   numeric,
  floor_area_m2  numeric,
  asking_price   bigint,                       -- giá chào (VND, D10)
  price_note     text,
  summary        text,
  highlights     text[] not null default '{}', -- ưu điểm nổi bật
  facts          jsonb not null default '[]',  -- [{nhan, gia_tri}] tổng quan
  sections       jsonb not null default '[]',  -- [{tieu_de, dong:[{nhan,gia_tri}], anh:[{url,chu_thich}]}]
  cash_flow      jsonb not null default '{}',  -- {mo_ta, bang:[{hang_muc,thang,nam}], ghi_chu, loi_suat}
  legal_public   jsonb not null default '{}',  -- {hinh_thuc, loai_dat, tinh_trang, ghi_chu}
  risks          text[] not null default '{}', -- điểm cần lưu ý / bất lợi (Quy chuẩn: phải nêu)
  cover_url      text,
  photos         jsonb not null default '[]',  -- [{url, chu_thich}]
  map_url        text,
  is_published   boolean not null default false,
  sort           int not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.property_private (
  property_id            uuid primary key references public.properties(id) on delete cascade,
  legal_detail           text,                 -- số GCN, số thửa, tờ bản đồ, cơ quan cấp, biến động
  sale_mandate_confirmed boolean not null default false,
  mandate_note           text,                 -- ai xác nhận, khi nào
  permit_expiry          date,                 -- hạn giấy phép (nếu có) để agent nhắc
  note                   text,
  updated_at             timestamptz not null default now()
);

alter table public.sale_listings    enable row level security;
alter table public.property_private enable row level security;

-- Hồ sơ bán: thành viên đã duyệt xem được (nội dung vốn để công khai); chỉ admin sửa
create policy "sale_listings: xem" on public.sale_listings for select using (can_read());
create policy "sale_listings: ghi" on public.sale_listings for all using (is_admin()) with check (is_admin());
-- Pháp lý chi tiết + mandate: chỉ admin
create policy "property_private: admin" on public.property_private for all using (is_admin()) with check (is_admin());
revoke all on public.sale_listings, public.property_private from anon;

-- ---------- Agent Hồ sơ: chặn xuất bản khi hồ sơ chưa đạt ----------
create or replace function public.sale_listings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_thieu text[] := '{}';
begin
  new.updated_at := now();
  if new.is_published then
    if new.asking_price is null then v_thieu := array_append(v_thieu, 'giá chào'); end if;
    if coalesce(btrim(new.legal_public ->> 'hinh_thuc'), '') = ''
       or coalesce(btrim(new.legal_public ->> 'tinh_trang'), '') = '' then
      v_thieu := array_append(v_thieu, 'pháp lý (hình thức + tình trạng)'); end if;
    if coalesce(array_length(new.risks, 1), 0) = 0 then v_thieu := array_append(v_thieu, 'điểm cần lưu ý'); end if;
    if not exists (select 1 from property_private
                    where property_id = new.property_id and sale_mandate_confirmed) then
      v_thieu := array_append(v_thieu, 'xác nhận mandate bán'); end if;
    if array_length(v_thieu, 1) > 0 then
      raise exception 'Chưa xuất bản được hồ sơ "%": còn thiếu %', new.title, array_to_string(v_thieu, ', ')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger sale_listings_guard before insert or update on public.sale_listings
for each row execute function public.sale_listings_guard();

create or replace function public.property_private_cham() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger property_private_cham before insert or update on public.property_private
for each row execute function public.property_private_cham();

-- ---------- View công khai cho site Mô House · Bán ----------
-- Chỉ liệt kê cột được phép công khai. KHÔNG có property_id, legal_detail, mandate.
create view public.public_sale_listings as
  select s.slug, s.title, s.tagline, s.area_label, s.kind_label, s.land_area_m2, s.floor_area_m2,
         s.asking_price, s.price_note, s.summary, s.highlights, s.facts, s.sections, s.cash_flow,
         s.legal_public, s.risks, s.cover_url, s.photos, s.map_url, s.sort, s.updated_at
    from public.sale_listings s
    join public.properties p on p.id = s.property_id
   where s.is_published and p.active;
grant select on public.public_sale_listings to anon, authenticated;

-- ---------- Agent Hồ sơ: chấm % hồ sơ ----------
create or replace function public.ho_so_ban_diem()
returns table (slug text, title text, is_published boolean, diem int, thieu text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Chỉ quản trị viên xem được điểm hồ sơ'; end if;
  return query
  with c as (
    select s.slug, s.title, s.is_published, array_remove(array[
      case when s.asking_price is null then 'giá chào' end,
      case when coalesce(btrim(s.summary), '') = '' then 'mô tả ngắn' end,
      case when coalesce(s.land_area_m2, 0) = 0 then 'diện tích đất' end,
      case when coalesce(btrim(s.map_url), '') = '' then 'định vị bản đồ' end,
      case when coalesce(btrim(s.cover_url), '') = '' then 'ảnh bìa' end,
      case when jsonb_array_length(s.photos) < 4 then 'ít nhất 4 ảnh' end,
      case when coalesce(array_length(s.highlights, 1), 0) < 3 then 'ít nhất 3 ưu điểm' end,
      case when coalesce(btrim(s.legal_public ->> 'hinh_thuc'), '') = ''
             or coalesce(btrim(s.legal_public ->> 'tinh_trang'), '') = '' then 'pháp lý công khai' end,
      case when coalesce(array_length(s.risks, 1), 0) = 0 then 'điểm cần lưu ý' end,
      case when coalesce(btrim(pp.legal_detail), '') = '' then 'pháp lý chi tiết (nội bộ)' end,
      case when not coalesce(pp.sale_mandate_confirmed, false) then 'xác nhận mandate bán' end
    ], null) as thieu
    from sale_listings s left join property_private pp on pp.property_id = s.property_id
  )
  select c.slug, c.title, c.is_published,
         (100 * (11 - coalesce(array_length(c.thieu, 1), 0)) / 11)::int, c.thieu
    from c order by c.slug;
end $$;

-- ---------- Nạp hồ sơ từ file (nút "Nhập hồ sơ" trên Mô Hub) ----------
-- p = { "tai_san": [ { "property": {code,name,aliases,kind,listing_type},
--                      "listing": {...các cột sale_listings, xuat_ban:true/false},
--                      "private": {legal_detail, sale_mandate_confirmed, mandate_note} } ] }
-- Nhà đã có (theo code) thì giữ nguyên thông tin cho thuê, chỉ gắn hồ sơ bán.
-- Mỗi tài sản xuất bản riêng: tài sản chưa đạt thì để nháp và báo lý do, không làm hỏng cả lượt nạp.
create or replace function public.nhap_tai_san_ban(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  t jsonb; l jsonb; v_prop uuid; v_kq jsonb := '[]'; v_ly_do text;
begin
  if not is_admin() then raise exception 'Chỉ quản trị viên nạp được hồ sơ tài sản'; end if;

  for t in select * from jsonb_array_elements(coalesce(p -> 'tai_san', '[]')) loop
    l := t -> 'listing';
    select id into v_prop from properties where code = t -> 'property' ->> 'code';
    if v_prop is null then
      insert into properties (code, name, aliases, kind, listing_type, sort)
      values (t -> 'property' ->> 'code', t -> 'property' ->> 'name',
              coalesce(array(select jsonb_array_elements_text(t -> 'property' -> 'aliases')), '{}'),
              t -> 'property' ->> 'kind', coalesce(t -> 'property' ->> 'listing_type', 'chuyen_nhuong'),
              coalesce((t -> 'property' ->> 'sort')::int, 100))
      returning id into v_prop;
    else
      -- nhà đã có (đang cho thuê): chỉ đổi loại niêm yết nếu file ghi rõ, ví dụ 'ca_hai'
      update properties set listing_type = coalesce(t -> 'property' ->> 'listing_type', listing_type)
       where id = v_prop;
    end if;

    insert into property_private (property_id, legal_detail, sale_mandate_confirmed, mandate_note)
    values (v_prop, t -> 'private' ->> 'legal_detail',
            coalesce((t -> 'private' ->> 'sale_mandate_confirmed')::boolean, false),
            t -> 'private' ->> 'mandate_note')
    on conflict (property_id) do update set   -- mục nào file không ghi thì giữ giá trị cũ
      legal_detail = case when t -> 'private' ? 'legal_detail' then excluded.legal_detail
                          else property_private.legal_detail end,
      sale_mandate_confirmed = case when t -> 'private' ? 'sale_mandate_confirmed' then excluded.sale_mandate_confirmed
                                    else property_private.sale_mandate_confirmed end,
      mandate_note = case when t -> 'private' ? 'mandate_note' then excluded.mandate_note
                          else property_private.mandate_note end;

    insert into sale_listings (property_id, slug, title, tagline, area_label, kind_label, land_area_m2,
      floor_area_m2, asking_price, price_note, summary, highlights, facts, sections, cash_flow,
      legal_public, risks, cover_url, photos, map_url, sort, is_published)
    values (v_prop, l ->> 'slug', l ->> 'title', l ->> 'tagline', l ->> 'area_label', l ->> 'kind_label',
      (l ->> 'land_area_m2')::numeric, (l ->> 'floor_area_m2')::numeric, (l ->> 'asking_price')::bigint,
      l ->> 'price_note', l ->> 'summary',
      coalesce(array(select jsonb_array_elements_text(l -> 'highlights')), '{}'),
      coalesce(l -> 'facts', '[]'), coalesce(l -> 'sections', '[]'), coalesce(l -> 'cash_flow', '{}'),
      coalesce(l -> 'legal_public', '{}'), coalesce(array(select jsonb_array_elements_text(l -> 'risks')), '{}'),
      l ->> 'cover_url', coalesce(l -> 'photos', '[]'), l ->> 'map_url', coalesce((l ->> 'sort')::int, 100), false)
    on conflict (property_id) do update set
      slug = excluded.slug, title = excluded.title, tagline = excluded.tagline, area_label = excluded.area_label,
      kind_label = excluded.kind_label, land_area_m2 = excluded.land_area_m2, floor_area_m2 = excluded.floor_area_m2,
      asking_price = excluded.asking_price, price_note = excluded.price_note, summary = excluded.summary,
      highlights = excluded.highlights, facts = excluded.facts, sections = excluded.sections,
      cash_flow = excluded.cash_flow, legal_public = excluded.legal_public, risks = excluded.risks,
      cover_url = excluded.cover_url, photos = excluded.photos, map_url = excluded.map_url, sort = excluded.sort,
      is_published = false;   -- về nháp, rồi xét xuất bản lại ngay dưới đây

    v_ly_do := null;
    if coalesce((l ->> 'xuat_ban')::boolean, false) then
      begin
        update sale_listings set is_published = true where property_id = v_prop;
      exception when check_violation then v_ly_do := sqlerrm;
      end;
    end if;
    v_kq := v_kq || jsonb_build_object('slug', l ->> 'slug',
      'xuat_ban', (select is_published from sale_listings where property_id = v_prop), 'ly_do', v_ly_do);
  end loop;
  return v_kq;
end $$;

revoke all on function public.ho_so_ban_diem()           from public, anon;
revoke all on function public.nhap_tai_san_ban(jsonb)    from public, anon;
grant execute on function public.ho_so_ban_diem()        to authenticated;
grant execute on function public.nhap_tai_san_ban(jsonb) to authenticated;
