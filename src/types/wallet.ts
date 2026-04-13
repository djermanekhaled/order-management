export type WalletTransactionType = "income" | "expense";

export interface Wallet {
  id: string;
  name: string;
  created_at: string;
  updated_at: string | null;
}

export interface WalletCategory {
  id: string;
  name: string;
  type: WalletTransactionType;
  color: string | null;
  created_at: string;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  category_id: string | null;
  note: string | null;
  amount: number | string;
  type: WalletTransactionType;
  created_at: string;
}
