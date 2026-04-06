-- Product / line SKU on orders (manual entry or synced from catalog).

alter table public.orders
  add column if not exists sku text not null default '';
