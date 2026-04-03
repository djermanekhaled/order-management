export type OrderStatus = "pending" | "confirmed" | "cancelled";

export interface Order {
  id: string;
  customer_name: string;
  product: string;
  amount: number;
  status: OrderStatus;
  created_at: string;
}

export interface NewOrderInput {
  customer_name: string;
  product: string;
  amount: number;
}
