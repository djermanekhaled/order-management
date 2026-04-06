alter table public.orders
  add column if not exists discount numeric default 0;
