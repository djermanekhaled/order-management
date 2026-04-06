-- Allow deleting orders from the app (bulk delete toolbar).

drop policy if exists "Allow public delete on orders" on public.orders;

create policy "Allow public delete on orders"
  on public.orders for delete
  using (true);
