alter table public.sales_channels
  add column if not exists platform text not null default 'woocommerce';

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

