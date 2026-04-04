-- Order management schema (fresh install, Supabase SQL Editor)
-- For existing projects, run migration_status_v2.sql after prior migrations.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null default '',
  wilaya text not null default '',
  address text not null default '',
  product text not null,
  quantity integer not null default 1 check (quantity >= 1),
  amount numeric(12, 2) not null check (amount >= 0),
  shipping_cost numeric(12, 2) not null default 0 check (shipping_cost >= 0),
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  notes text not null default '',
  status text not null default 'new'
    check (status in (
      'new',
      'under_process',
      'confirmed',
      'follow',
      'completed',
      'cancelled'
    )),
  sub_status text,
  source text not null default 'Manual',
  delivery_company text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_sub_status_check check (
    sub_status is null or sub_status in (
      'call_1', 'call_2', 'call_3', 'postponed',
      'delivered', 'returned',
      'cancelled', 'fake_order', 'duplicated',
      'confirmed'
    )
  )
);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  previous_status text,
  new_status text not null,
  previous_sub_status text,
  new_sub_status text,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_status_sub on public.orders (status, sub_status);
create index if not exists idx_orders_created_at on public.orders (created_at);
create index if not exists idx_orders_wilaya on public.orders (wilaya);
create index if not exists idx_order_status_history_order_id
  on public.order_status_history (order_id);

create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  store_url text not null,
  consumer_key text not null,
  consumer_secret text not null,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_channels_status on public.sales_channels (status);

create or replace function public.set_sales_channels_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_sales_channels_updated_at on public.sales_channels;
create trigger tr_sales_channels_updated_at
  before update on public.sales_channels
  for each row
  execute function public.set_sales_channels_updated_at();

alter table public.sales_channels enable row level security;

drop policy if exists "Allow public read sales_channels" on public.sales_channels;
drop policy if exists "Allow public insert sales_channels" on public.sales_channels;
drop policy if exists "Allow public update sales_channels" on public.sales_channels;
drop policy if exists "Allow public delete sales_channels" on public.sales_channels;

create policy "Allow public read sales_channels"
  on public.sales_channels for select
  using (true);

create policy "Allow public insert sales_channels"
  on public.sales_channels for insert
  with check (true);

create policy "Allow public update sales_channels"
  on public.sales_channels for update
  using (true)
  with check (true);

create policy "Allow public delete sales_channels"
  on public.sales_channels for delete
  using (true);

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

alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;

drop policy if exists "Allow public read on orders" on public.orders;
drop policy if exists "Allow public insert on orders" on public.orders;
drop policy if exists "Allow public update on orders" on public.orders;

create policy "Allow public read on orders"
  on public.orders for select
  using (true);

create policy "Allow public insert on orders"
  on public.orders for insert
  with check (true);

create policy "Allow public update on orders"
  on public.orders for update
  using (true)
  with check (true);

drop policy if exists "Allow public read order history" on public.order_status_history;

create policy "Allow public read order history"
  on public.order_status_history for select
  using (true);
