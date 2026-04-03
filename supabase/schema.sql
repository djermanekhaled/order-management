-- Run this in Supabase SQL Editor (Dashboard → SQL → New query)

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  product text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

-- Allow read/write for anon (adjust for production: use auth.uid() policies)
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
