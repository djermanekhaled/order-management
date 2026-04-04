-- Inventory: on-hand stock on products and variants.
-- Run in Supabase SQL Editor after migration_products.sql.

alter table public.products
  add column if not exists current_stock integer not null default 0
  check (current_stock >= 0);

alter table public.product_variants
  add column if not exists current_stock integer not null default 0
  check (current_stock >= 0);

comment on column public.products.current_stock is 'On-hand quantity for the base product (when no variants or aggregate context)';
comment on column public.product_variants.current_stock is 'On-hand quantity for this variant';
