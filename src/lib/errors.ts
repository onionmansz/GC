import { logError } from './redact'

// Maps server/network errors to fixed, friendly text. Raw messages are never shown,
// because Postgres/PostgREST errors can echo submitted values (e.g. a card number).

const MESSAGES: Record<string, string> = {
  insufficient_balance: "That's more than the card's balance.",
  invalid_amount: 'Enter a valid amount.',
  not_found: 'That item no longer exists.',
  already_member: "You're already in a household.",
  no_invite: 'No pending invite for your email. Ask your household to invite you first.',
  not_authenticated: 'Please sign in again.',
  cards_unique_number: 'That card number is already saved for this merchant.',
  merchants_household_name: 'A merchant with that name already exists.',
  not_supported: 'Automatic checks aren\u2019t set up for this merchant.',
  in_use: 'This merchant still has cards. Move or delete them first.',
  offline: "You're offline. Changes need a connection.",
}

const GENERIC = 'Something went wrong. Please try again.'

export function errorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { message?: unknown; code?: unknown }
  const message = typeof e.message === 'string' ? e.message : ''
  // Our RPCs/triggers raise bare codes as the message.
  if (Object.hasOwn(MESSAGES, message)) return message
  if (e.code === '23505') {
    if (message.includes('cards_unique_number')) return 'cards_unique_number'
    if (message.includes('merchants_household_name')) return 'merchants_household_name'
  }
  if (e.code === '23503') return 'in_use'
  if (message === 'Failed to fetch' || message.includes('NetworkError') || message.includes('Load failed')) return 'offline'
  return null
}

export function userMessage(err: unknown, context = 'request'): string {
  const code = errorCode(err)
  if (code) return MESSAGES[code]
  logError(context, err)
  return GENERIC
}
