-- Delivery companies (ZR Express, etc.) + order shipping metadata.
-- Run in Supabase SQL Editor after existing migrations.

create table if not exists public.delivery_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'zr_express'
    check (type = 'zr_express'),
  secret_key text not null,
  tenant_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_companies_active on public.delivery_companies (active);

alter table public.delivery_companies enable row level security;

drop policy if exists "Allow public read delivery_companies" on public.delivery_companies;
drop policy if exists "Allow public insert delivery_companies" on public.delivery_companies;
drop policy if exists "Allow public update delivery_companies" on public.delivery_companies;
drop policy if exists "Allow public delete delivery_companies" on public.delivery_companies;

create policy "Allow public read delivery_companies"
  on public.delivery_companies for select using (true);
create policy "Allow public insert delivery_companies"
  on public.delivery_companies for insert with check (true);
create policy "Allow public update delivery_companies"
  on public.delivery_companies for update using (true) with check (true);
create policy "Allow public delete delivery_companies"
  on public.delivery_companies for delete using (true);

alter table public.orders
  add column if not exists shipping_status text;

alter table public.orders
  add column if not exists tracking_number text not null default '';

comment on column public.orders.shipping_status is 'Carrier/shipping pipeline state (e.g. zr_validated)';
comment on column public.orders.tracking_number is 'Carrier tracking / parcel id';
