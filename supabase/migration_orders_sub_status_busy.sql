-- Allow `busy` as under_process sub_status (New → Under Process workflow).

alter table public.orders drop constraint if exists orders_sub_status_check;

alter table public.orders add constraint orders_sub_status_check check (
  sub_status is null or sub_status in (
    'call_1', 'call_2', 'call_3', 'postponed', 'busy',
    'delivered', 'returned',
    'cancelled', 'fake_order', 'duplicated',
    'confirmed'
  )
);
