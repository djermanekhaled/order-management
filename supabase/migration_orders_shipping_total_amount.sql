-- Orders: shipping line + grand total (WooCommerce total includes shipping).
-- Run in Supabase SQL Editor after existing migrations.

alter table public.orders
  add column if not exists shipping_cost numeric(12, 2) not null default 0
  check (shipping_cost >= 0);

alter table public.orders
  add column if not exists total_amount numeric(12, 2) not null default 0
  check (total_amount >= 0);

-- Backfill legacy rows (new columns default to 0): treat former `amount` as full order total.
update public.orders
set
  shipping_cost = 0,
  total_amount = amount
where total_amount = 0 and shipping_cost = 0;

comment on column public.orders.shipping_cost is 'Shipping / delivery amount (e.g. WooCommerce shipping_total)';
comment on column public.orders.total_amount is 'Final order total including shipping (e.g. WooCommerce total)';
comment on column public.orders.amount is 'Product / line-items subtotal (excludes shipping)';
