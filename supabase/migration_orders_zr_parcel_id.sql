-- ZR Express parcel id returned from parcels/bulk (and optional webhook sync).
alter table public.orders
  add column if not exists zr_parcel_id text not null default '';
