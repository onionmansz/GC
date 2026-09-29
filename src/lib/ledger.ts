// Pure ledger rules. The database is authoritative (card_balances view,
// set_card_balance RPC, transactions_after_insert trigger); these mirror it so the
// UI can validate before sending and so the rules are unit-tested.

export type TransactionType = 'load' | 'spend' | 'adjust'

export interface LedgerEntry {
  amount_cents: number
}

/** Balance is the sum of all transactions. */
export function balanceOf(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amount_cents, 0)
}

/** Signed amount of the 'adjust' transaction needed to move `current` to `target`. 0 = none needed. */
export function adjustDelta(currentCents: number, targetCents: number): number {
  return targetCents - currentCents
}

/** Signed amount stored for a user-entered positive amount. */
export function signedAmount(type: Exclude<TransactionType, 'adjust'>, cents: number): number {
  return type === 'spend' ? -Math.abs(cents) : Math.abs(cents)
}

/** Auto-archive rule applied after every transaction: archived exactly when the balance is $0. */
export function archivedAfterTransaction(balanceCents: number): boolean {
  return balanceCents === 0
}

export type AmountCheck = { ok: true } | { ok: false; reason: 'not_positive' | 'exceeds_balance' }

export function checkSpend(balanceCents: number, spendCents: number | null): AmountCheck {
  if (spendCents === null || spendCents <= 0) return { ok: false, reason: 'not_positive' }
  if (spendCents > balanceCents) return { ok: false, reason: 'exceeds_balance' }
  return { ok: true }
}

export function checkLoad(loadCents: number | null): AmountCheck {
  if (loadCents === null || loadCents <= 0) return { ok: false, reason: 'not_positive' }
  return { ok: true }
}

/** Cards within a merchant: lowest balance first (use those up first), then oldest. */
export function sortByLowestBalance<T extends { balance_cents: number; created_at: string }>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => a.balance_cents - b.balance_cents || a.created_at.localeCompare(b.created_at))
}
