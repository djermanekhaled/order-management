/** Normalize order / catalog product text for comparison. */
export function normProductLabel(s: string): string {
  return s.trim().toLowerCase();
}

/** Count orders whose `product` equals any of the given catalog names (each order counted at most once). */
export function countOrdersMatchingAnyProductName(
  orders: { product: string }[],
  catalogNames: string[]
): number {
  const names = new Set(
    catalogNames.map(normProductLabel).filter((n) => n.length > 0)
  );
  if (names.size === 0) return 0;
  return orders.reduce((acc, row) => {
    const o = normProductLabel(row.product);
    if (!o) return acc;
    return acc + (names.has(o) ? 1 : 0);
  }, 0);
}
