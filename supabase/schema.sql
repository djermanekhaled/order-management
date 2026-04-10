-- Order management schema (fresh install, Supabase SQL Editor)
-- For existing projects, run migration_status_v2.sql after prior migrations.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null default '',
  wilaya text not null default '',
  commune text not null default '',
  wilaya_territory_id text not null default '',
  commune_territory_id text not null default '',
  address text not null default '',
  product text not null,
  sku text not null default '',
  quantity integer not null default 1 check (quantity >= 1),
  amount numeric(12, 2) not null check (amount >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  shipping_cost numeric(12, 2) not null default 0 check (shipping_cost >= 0),
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  notes text not null default '',
  status text not null default 'new'
    check (status in (
      'new',
      'under_process',
      'confirmed',
      'follow',
      'completed',
      'cancelled'
    )),
  sub_status text,
  source text not null default 'Manual',
  delivery_company text not null default '',
  delivery_type text not null default 'home'
    check (delivery_type in ('home', 'pickup-point')),
  shipping_status text,
  tracking_number text not null default '',
  internal_tracking_id text not null default '',
  zr_parcel_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_sub_status_check check (
    sub_status is null or sub_status in (
      'call_1', 'call_2', 'call_3', 'postponed', 'busy',
      'delivered', 'returned',
      'cancelled', 'fake_order', 'duplicated',
      'confirmed'
    )
  )
);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  previous_status text,
  new_status text not null,
  previous_sub_status text,
  new_sub_status text,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_status_sub on public.orders (status, sub_status);
create index if not exists idx_orders_created_at on public.orders (created_at);
create index if not exists idx_orders_wilaya on public.orders (wilaya);
create index if not exists idx_order_status_history_order_id
  on public.order_status_history (order_id);

create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text not null default 'woocommerce'
    check (platform in ('woocommerce', 'shopify', 'google_sheet')),
  store_url text not null,
  consumer_key text not null,
  consumer_secret text not null,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  last_synced_at timestamptz null,
  webhook_secret text not null default '',
  woo_webhook_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_channels_status on public.sales_channels (status);

create or replace function public.set_sales_channels_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_sales_channels_updated_at on public.sales_channels;
create trigger tr_sales_channels_updated_at
  before update on public.sales_channels
  for each row
  execute function public.set_sales_channels_updated_at();

alter table public.sales_channels enable row level security;

drop policy if exists "Allow public read sales_channels" on public.sales_channels;
drop policy if exists "Allow public insert sales_channels" on public.sales_channels;
drop policy if exists "Allow public update sales_channels" on public.sales_channels;
drop policy if exists "Allow public delete sales_channels" on public.sales_channels;

create policy "Allow public read sales_channels"
  on public.sales_channels for select
  using (true);

create policy "Allow public insert sales_channels"
  on public.sales_channels for insert
  with check (true);

create policy "Allow public update sales_channels"
  on public.sales_channels for update
  using (true)
  with check (true);

create policy "Allow public delete sales_channels"
  on public.sales_channels for delete
  using (true);

create or replace function public.set_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_orders_updated_at on public.orders;
create trigger tr_orders_updated_at
  before update on public.orders
  for each row
  execute function public.set_orders_updated_at();

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (
      order_id, previous_status, new_status, previous_sub_status, new_sub_status
    )
    values (new.id, null, new.status, null, new.sub_status);
  elsif tg_op = 'UPDATE' and (
    old.status is distinct from new.status
    or coalesce(old.sub_status, '') is distinct from coalesce(new.sub_status, '')
  ) then
    insert into public.order_status_history (
      order_id, previous_status, new_status, previous_sub_status, new_sub_status
    )
    values (
      new.id,
      old.status,
      new.status,
      old.sub_status,
      new.sub_status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tr_orders_status_history_ai on public.orders;
create trigger tr_orders_status_history_ai
  after insert on public.orders
  for each row
  execute function public.log_order_status_change();

drop trigger if exists tr_orders_status_history_au on public.orders;
create trigger tr_orders_status_history_au
  after update on public.orders
  for each row
  execute function public.log_order_status_change();

alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;

drop policy if exists "Allow public read on orders" on public.orders;
drop policy if exists "Allow public insert on orders" on public.orders;
drop policy if exists "Allow public update on orders" on public.orders;

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

create policy "Allow public delete on orders"
  on public.orders for delete
  using (true);

drop policy if exists "Allow public read order history" on public.order_status_history;

create policy "Allow public read order history"
  on public.order_status_history for select
  using (true);

-- Products catalog (see migration_products.sql for incremental install)

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text not null,
  purchase_price numeric(12, 2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(12, 2) not null default 0 check (sale_price >= 0),
  confirmation_fee numeric(12, 2) not null default 0 check (confirmation_fee >= 0),
  tracking_fee numeric(12, 2) not null default 0 check (tracking_fee >= 0),
  min_stock_alert integer not null default 0 check (min_stock_alert >= 0),
  current_stock integer not null default 0 check (current_stock >= 0),
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
  current_stock integer not null default 0 check (current_stock >= 0),
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

-- Delivery companies (ZR Express credentials; see migration_delivery_companies_and_order_shipping.sql)

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

-- ZR territories cache (city/district GUIDs from ZR Express hubs/search)

create table if not exists public.zr_territories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.delivery_companies (id) on delete cascade,
  territory_id uuid not null,
  kind text not null check (kind in ('city', 'district')),
  name text not null,
  normalized_name text not null,
  parent_city_territory_id uuid,
  source text not null default 'hubs_search',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zr_territories_company_territory_kind_unique
    unique (company_id, territory_id, kind)
);

create index if not exists idx_zr_territories_company_kind_norm
  on public.zr_territories (company_id, kind, normalized_name);
create index if not exists idx_zr_territories_company_parent
  on public.zr_territories (company_id, parent_city_territory_id);

create or replace function public.set_zr_territories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_zr_territories_updated_at on public.zr_territories;
create trigger tr_zr_territories_updated_at
  before update on public.zr_territories
  for each row
  execute function public.set_zr_territories_updated_at();

alter table public.zr_territories enable row level security;

drop policy if exists "Allow public read zr_territories" on public.zr_territories;
drop policy if exists "Allow public insert zr_territories" on public.zr_territories;
drop policy if exists "Allow public update zr_territories" on public.zr_territories;
drop policy if exists "Allow public delete zr_territories" on public.zr_territories;

create policy "Allow public read zr_territories"
  on public.zr_territories for select using (true);
create policy "Allow public insert zr_territories"
  on public.zr_territories for insert with check (true);
create policy "Allow public update zr_territories"
  on public.zr_territories for update using (true) with check (true);
create policy "Allow public delete zr_territories"
  on public.zr_territories for delete using (true);
