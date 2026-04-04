export type DeliveryCompanyType = "zr_express";

export interface DeliveryCompany {
  id: string;
  name: string;
  type: DeliveryCompanyType;
  token: string;
  tenant_id: string;
  active: boolean;
  created_at: string;
}
