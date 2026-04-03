-- Migration: two-field status (status + sub_status), remove `shipped`, extend history.
-- Run in Supabase SQL Editor after your current schema is deployed.

-- 1) Add sub_status to orders
alter table public.orders add column if not exists sub_status text;

-- 2) Relax then replace status constraint (migrate legacy values)
alter table public.orders drop constraint if exists orders_status_check;

-- Map removed / legacy statuses before new constraint
update public.orders
set status = 'completed', sub_status = 'delivered'
where status = 'shipped';

update public.orders
set sub_status = 'call_1'
where status = 'under_process' and sub_status is null;

update public.orders
set sub_status = 'delivered'
where status = 'completed' and sub_status is null;

update public.orders
set sub_status = 'cancelled'
where status = 'cancelled' and sub_status is null;

update public.orders
set sub_status = null
where status in ('new', 'confirmed', 'follow') and sub_status is not null;

-- Ensure confirmed-like rows have `sub_status = 'confirmed'`
update public.orders
set sub_status = 'confirmed'
where status in ('confirmed', 'follow')
  and (sub_status is null or sub_status = '');

-- Legacy `pending` → new + null
update public.orders
set status = 'new', sub_status = null
where status = 'pending';

-- 3) New status check (no shipped)
alter table public.orders add constraint orders_status_check check (status in (
  'new',
  'under_process',
  'confirmed',
  'follow',
  'completed',
  'cancelled'
));

-- 4) Sub-status allowed values (nullable)
alter table public.orders drop constraint if exists orders_sub_status_check;
alter table public.orders add constraint orders_sub_status_check check (
  sub_status is null or sub_status in (
    'call_1', 'call_2', 'call_3', 'postponed',
    'delivered', 'returned',
    'cancelled', 'fake_order', 'duplicated',
    'confirmed'
  )
);

create index if not exists idx_orders_status_sub on public.orders (status, sub_status);

-- 5) History: sub_status columns
alter table public.order_status_history add column if not exists previous_sub_status text;
alter table public.order_status_history add column if not exists new_sub_status text;

-- 6) Replace logging trigger (status or sub_status change)
create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (
      order_id, previous_status, new_status, previous_sub_status, new_sub_status
    )
    values (new.id, null, new.status, null, new.sub_status);
  elsif tg_op = 'UPDATE' and (
    old.status is distinct from new.status
    or coalesce(old.sub_status, '') is distinct from coalesce(new.sub_status, '')
  ) then
    insert into public.order_status_history (
      order_id, previous_status, new_status, previous_sub_status, new_sub_status
    )
    values (
      new.id,
      old.status,
      new.status,
      old.sub_status,
      new.sub_status
    );
  end if;
  return new;
end;
$$;
