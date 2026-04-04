-- Commune, delivery type, internal tracking reference (manual + API).

alter table public.orders
  add column if not exists commune text not null default '';

alter table public.orders
  add column if not exists delivery_type text not null default 'home';

alter table public.orders
  drop constraint if exists orders_delivery_type_check;

alter table public.orders
  add constraint orders_delivery_type_check
  check (delivery_type in ('home', 'pickup-point'));

alter table public.orders
  add column if not exists internal_tracking_id text not null default '';

create index if not exists idx_orders_internal_tracking_id
  on public.orders (internal_tracking_id)
  where internal_tracking_id <> '';
