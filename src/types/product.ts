export interface Product {
  id: string;
  name: string;
  sku: string;
  purchase_price: number;
  sale_price: number;
  confirmation_fee: number;
  tracking_fee: number;
  min_stock_alert: number;
  current_stock?: number;
  active: boolean;
  created_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  purchase_price: number;
  sale_price: number;
  confirmation_fee: number;
  tracking_fee: number;
  min_stock_alert: number;
  current_stock?: number;
  active: boolean;
  created_at: string;
}

/** Variant row in the product form (clientKey is local only). */
export type ProductVariantDraft = {
  clientKey: string;
  name: string;
  sku: string;
  purchase_price: number;
  sale_price: number;
  confirmation_fee: number;
  tracking_fee: number;
  min_stock_alert: number;
  active: boolean;
};

export type ProductFormValues = Omit<Product, "id" | "created_at">;
