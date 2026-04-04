-- Products + variants (catalog). Run after existing migrations.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text not null,
  purchase_price numeric(12, 2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(12, 2) not null default 0 check (sale_price >= 0),
  confirmation_fee numeric(12, 2) not null default 0 check (confirmation_fee >= 0),
  tracking_fee numeric(12, 2) not null default 0 check (tracking_fee >= 0),
  min_stock_alert integer not null default 0 check (min_stock_alert >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint products_sku_unique unique (sku)
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  sku text not null,
  purchase_price numeric(12, 2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(12, 2) not null default 0 check (sale_price >= 0),
  confirmation_fee numeric(12, 2) not null default 0 check (confirmation_fee >= 0),
  tracking_fee numeric(12, 2) not null default 0 check (tracking_fee >= 0),
  min_stock_alert integer not null default 0 check (min_stock_alert >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_variants_product_sku_unique unique (product_id, sku)
);

create index if not exists idx_products_active on public.products (active);
create index if not exists idx_product_variants_product_id on public.product_variants (product_id);

alter table public.products enable row level security;
alter table public.product_variants enable row level security;

drop policy if exists "Allow public read products" on public.products;
drop policy if exists "Allow public insert products" on public.products;
drop policy if exists "Allow public update products" on public.products;
drop policy if exists "Allow public delete products" on public.products;

create policy "Allow public read products"
  on public.products for select using (true);
create policy "Allow public insert products"
  on public.products for insert with check (true);
create policy "Allow public update products"
  on public.products for update using (true) with check (true);
create policy "Allow public delete products"
  on public.products for delete using (true);

drop policy if exists "Allow public read product_variants" on public.product_variants;
drop policy if exists "Allow public insert product_variants" on public.product_variants;
drop policy if exists "Allow public update product_variants" on public.product_variants;
drop policy if exists "Allow public delete product_variants" on public.product_variants;

create policy "Allow public read product_variants"
  on public.product_variants for select using (true);
create policy "Allow public insert product_variants"
  on public.product_variants for insert with check (true);
create policy "Allow public update product_variants"
  on public.product_variants for update using (true) with check (true);
create policy "Allow public delete product_variants"
  on public.product_variants for delete using (true);
