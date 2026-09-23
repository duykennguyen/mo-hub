-- =====================================================================
-- THU KHÁC & CHI PHÍ
--
-- Bối cảnh (22/09/2026): Mô tự vận hành trực tiếp, chấm dứt hợp tác với
-- đơn vị vận hành ngoài. Vì vậy sổ sách KHÔNG còn chia doanh thu 20/80
-- giữa "đơn vị vận hành" và "chủ nhà" như bảng Google Sheets cũ, và cũng
-- không còn cột "Paid by" (Xuyên / Milan / Inn).
--
-- Lợi nhuận = (doanh thu phòng + thu khác) − chi phí.
--
-- Hai bảng mới:
--   other_income — điện nước thu lại của khách, dịch vụ bán thêm…
--   expenses     — chi phí vận hành, mua sắm tài sản
-- Cả hai dùng lại đúng mẫu của bookings: xóa mềm, ghi người tạo, RLS.
-- =====================================================================

-- ---------- Thu khác ----------
create table public.other_income (
  id           bigint generated always as identity primary key,
  property_id  uuid references public.properties(id),   -- null = không gắn nhà nào
  unit_id      uuid references public.units(id),
  booking_id   bigint references public.bookings(id) on delete set null,
  received_on  date   not null,
  kind         text   not null default 'dien_nuoc',     -- dien_nuoc / dich_vu / khac
  description  text   not null,
  amount       bigint not null default 0,
  note         text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  check (amount >= 0)
);
create index on public.other_income (received_on);
create index on public.other_income (property_id, received_on);

-- ---------- Chi phí ----------
create table public.expenses (
  id          bigint generated always as identity primary key,
  property_id uuid references public.properties(id),    -- null = chi phí chung cho cả hệ thống
  spent_on    date   not null,
  item        text   not null,
  amount      bigint not null default 0,
  category    text   not null default 'quan_ly_chung',
  -- quan_ly_chung / mua_tai_san / sua_chua / dien_nuoc / giat_ui / luong / hoa_hong / khac
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  check (amount >= 0)
);
create index on public.expenses (spent_on);
create index on public.expenses (property_id, spent_on);

-- ---------- Trigger: tự điền người tạo, chặn người thường xóa ----------
create or replace function public.so_sach_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor_label());
  else
    if new.deleted_at is distinct from old.deleted_at
       and auth.uid() is not null and not is_admin() then
      raise exception 'Chỉ quản trị viên được xóa hoặc khôi phục dòng sổ sách';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger other_income_guard before insert or update on public.other_income
for each row execute function public.so_sach_guard();
create trigger expenses_guard before insert or update on public.expenses
for each row execute function public.so_sach_guard();

-- ---------- Phân quyền ----------
-- Xem: chủ đầu tư trở lên (cùng nhóm với booking và payments).
-- Ghi: quản trị viên và quản lý. Xóa cứng: chỉ quản trị viên.
alter table public.other_income enable row level security;
alter table public.expenses     enable row level security;

create policy "other_income: xem" on public.other_income for select
  using (can_view_booking() and (deleted_at is null or is_admin()));
create policy "other_income: thêm" on public.other_income for insert with check (can_book());
create policy "other_income: sửa"  on public.other_income for update
  using (can_book()) with check (can_book());
create policy "other_income: xóa"  on public.other_income for delete using (is_admin());

create policy "expenses: xem" on public.expenses for select
  using (can_view_booking() and (deleted_at is null or is_admin()));
create policy "expenses: thêm" on public.expenses for insert with check (can_book());
create policy "expenses: sửa"  on public.expenses for update
  using (can_book()) with check (can_book());
create policy "expenses: xóa"  on public.expenses for delete using (is_admin());

-- Khách vãng lai không bao giờ được đụng tới sổ sách
revoke all on public.other_income from anon;
revoke all on public.expenses     from anon;
