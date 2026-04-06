alter table public.orders
  add column if not exists discount numeric(12, 2) not null default 0
  check (discount >= 0);
