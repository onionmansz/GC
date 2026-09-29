import type { BarcodeFormat } from '../lib/barcode/formats'
import type { TransactionType } from '../lib/ledger'

export interface Member {
  household_id: string
  user_id: string
  display_name: string
}

export interface Household {
  id: string
  name: string
}

export interface MerchantSummary {
  merchant_id: string
  household_id: string
  name: string
  category: string
  color: string
  balance_check_url: string | null
  active_card_count: number
  total_balance_cents: number
}

export interface Card {
  id: string
  household_id: string
  merchant_id: string
  label: string | null
  card_number: string
  pin: string | null
  barcode_format: BarcodeFormat | null
  barcode_value: string | null
  barcode_image_path: string | null
  held_by: string | null
  archived: boolean
  balance_checked_at: string | null
  created_by: string
  created_at: string
}

export interface CardWithBalance extends Card {
  balance_cents: number
  last_activity_at: string | null
}

export interface Transaction {
  id: string
  card_id: string
  type: TransactionType
  amount_cents: number
  note: string | null
  created_by: string
  created_at: string
}

export interface Invite {
  household_id: string
  email: string
  display_name: string
  created_at: string
  accepted_at: string | null
}
