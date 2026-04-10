alter table public.orders
  add column if not exists hub_id text not null default '';

