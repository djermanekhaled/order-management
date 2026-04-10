-- WooCommerce auto-webhook + incremental sync cursor (per sales channel).
alter table public.sales_channels
  add column if not exists platform text not null default 'woocommerce',
  add column if not exists last_synced_at timestamptz null,
  add column if not exists webhook_secret text not null default '',
  add column if not exists woo_webhook_id text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_channels_platform_check'
  ) then
    alter table public.sales_channels
      add constraint sales_channels_platform_check
      check (platform in ('woocommerce', 'shopify', 'google_sheet'));
  end if;
end $$;
