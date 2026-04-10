export type DeliveryCompanyType =
  | "zr_express"
  | "yalidine"
  | "noest"
  | "dhd"
  | "maystro";
export type DeliveryCompanyProvider = DeliveryCompanyType;

export interface DeliveryCompany {
  id: string;
  name: string;
  type: DeliveryCompanyType;
  provider: DeliveryCompanyProvider;
  secret_key: string;
  tenant_id: string;
  active: boolean;
  created_at: string;
}
