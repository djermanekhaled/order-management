export type SalesChannelStatus = "active" | "inactive";

export interface SalesChannel {
  id: string;
  name: string;
  store_url: string;
  consumer_key: string;
  consumer_secret: string;
  status: SalesChannelStatus;
  created_at: string;
  updated_at: string;
}
