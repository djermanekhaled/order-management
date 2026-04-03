-- Sales channels + orders.source
-- Run in Supabase SQL Editor after existing migrations.

-- 1) orders.source: manual orders = 'Manual'; channel syncs use channel name
alter table public.orders add column if not exists source text not null default 'Manual';

update public.orders
set source = 'Manual'
where source is null or source = '';

-- 2) sales_channels (WooCommerce REST credentials)
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
