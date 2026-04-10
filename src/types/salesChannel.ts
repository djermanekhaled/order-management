export type SalesChannelStatus = "active" | "inactive";
export type SalesChannelPlatform = "woocommerce" | "shopify" | "google_sheet";

export interface SalesChannel {
  id: string;
  name: string;
  platform: SalesChannelPlatform;
  store_url: string;
  consumer_key: string;
  consumer_secret: string;
  status: SalesChannelStatus;
  last_synced_at: string | null;
  woo_webhook_id: string;
  created_at: string;
  updated_at: string;
}
