-- ZR Express territories cache (city/district GUID mapping per delivery company)
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
