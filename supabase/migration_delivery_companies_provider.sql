alter table public.delivery_companies
  add column if not exists provider text not null default 'zr_express';

update public.delivery_companies
set provider = case
  when type in ('zr_express', 'yalidine', 'noest', 'dhd', 'maystro') then type
  else 'zr_express'
end
where provider is null or provider = '';

alter table public.delivery_companies
  drop constraint if exists delivery_companies_type_check;

alter table public.delivery_companies
  add constraint delivery_companies_type_check
  check (type in ('zr_express', 'yalidine', 'noest', 'dhd', 'maystro'));

alter table public.delivery_companies
  drop constraint if exists delivery_companies_provider_check;

alter table public.delivery_companies
  add constraint delivery_companies_provider_check
  check (provider in ('zr_express', 'yalidine', 'noest', 'dhd', 'maystro'));

