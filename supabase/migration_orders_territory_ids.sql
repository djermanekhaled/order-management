-- ZR Express territory UUIDs chosen in order forms (wilaya / commune).
alter table public.orders
  add column if not exists wilaya_territory_id text not null default '';

alter table public.orders
  add column if not exists commune_territory_id text not null default '';
