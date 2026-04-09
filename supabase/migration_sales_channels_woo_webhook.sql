-- WooCommerce auto-webhook + incremental sync cursor (per sales channel).
alter table public.sales_channels
  add column if not exists last_synced_at timestamptz null,
  add column if not exists webhook_secret text not null default '',
  add column if not exists woo_webhook_id text not null default '';
