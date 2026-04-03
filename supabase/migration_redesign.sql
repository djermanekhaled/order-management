-- Run in Supabase SQL Editor when upgrading from the original schema
-- (customer_name, product, amount, status pending|confirmed|cancelled only).

-- 1) Add new columns (safe if already present)
alter table public.orders add column if not exists phone text not null default '';
alter table public.orders add column if not exists wilaya text not null default '';
alter table public.orders add column if not exists address text not null default '';
alter table public.orders add column if not exists quantity integer not null default 1;
alter table public.orders add column if not exists notes text not null default '';
alter table public.orders add column if not exists delivery_company text not null default '';
alter table public.orders add column if not exists updated_at timestamptz not null default now();

-- Fix quantity constraint if missing
alter table public.orders drop constraint if exists orders_quantity_check;
alter table public.orders add constraint orders_quantity_check check (quantity >= 1);

-- 2) Map legacy statuses before changing check constraint
alter table public.orders drop constraint if exists orders_status_check;
update public.orders
set status = case
  when status = 'pending' then 'new'
  else status
end
where status in ('pending', 'confirmed', 'cancelled');

-- 3) New status check (full workflow set)
alter table public.orders add constraint orders_status_check check (status in (
  'new',
  'under_process',
  'confirmed',
  'shipped',
  'completed',
  'follow',
  'cancelled'
));

-- 4) History table, triggers, RLS (idempotent)
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  previous_status text,
  new_status text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_status_history_order_id
  on public.order_status_history (order_id);
create index if not exists idx_orders_wilaya on public.orders (wilaya);

create or replace function public.set_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_orders_updated_at on public.orders;
create trigger tr_orders_updated_at
  before update on public.orders
  for each row
  execute function public.set_orders_updated_at();

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, previous_status, new_status)
    values (new.id, null, new.status);
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.order_status_history (order_id, previous_status, new_status)
    values (new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists tr_orders_status_history_ai on public.orders;
create trigger tr_orders_status_history_ai
  after insert on public.orders
  for each row
  execute function public.log_order_status_change();

drop trigger if exists tr_orders_status_history_au on public.orders;
create trigger tr_orders_status_history_au
  after update on public.orders
  for each row
  execute function public.log_order_status_change();

alter table public.order_status_history enable row level security;

drop policy if exists "Allow public read order history" on public.order_status_history;
create policy "Allow public read order history"
  on public.order_status_history for select
  using (true);

-- 5) Backfill initial history rows for existing orders (no duplicate per order)
insert into public.order_status_history (order_id, previous_status, new_status, created_at)
select o.id, null, o.status, o.created_at
from public.orders o
where not exists (
  select 1 from public.order_status_history h where h.order_id = o.id
);
