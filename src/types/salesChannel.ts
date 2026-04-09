export type SalesChannelStatus = "active" | "inactive";

export interface SalesChannel {
  id: string;
  name: string;
  store_url: string;
  consumer_key: string;
  consumer_secret: string;
  status: SalesChannelStatus;
  last_synced_at: string | null;
  woo_webhook_id: string;
  created_at: string;
  updated_at: string;
}
