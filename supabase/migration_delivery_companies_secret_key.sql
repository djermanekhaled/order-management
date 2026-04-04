-- Rename delivery_companies.token → secret_key (ZR Express uses secretKey / Bearer auth).
-- Safe if the column was already renamed or table is new with secret_key only.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'delivery_companies'
      and column_name = 'token'
  ) then
    alter table public.delivery_companies
      rename column token to secret_key;
  end if;
end $$;

comment on column public.delivery_companies.secret_key is 'ZR Express API secret key (sent as Authorization: Bearer {secretKey})';
