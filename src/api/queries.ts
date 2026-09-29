import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, IMAGE_BUCKET } from '../lib/supabase'
import { signedAmount } from '../lib/ledger'
import type { BarcodeFormat } from '../lib/barcode/formats'
import type { BalanceCheck, Card, CardWithBalance, Household, Invite, Member, MerchantSummary, Transaction } from './types'
import type { AutoCheckProvider } from '../lib/autoCheck'
import { useAuth } from '../auth/AuthProvider'

// Query keys contain only ids — never card numbers or PINs.
export const keys = {
  household: (userId: string | undefined) => ['household', userId] as const,
  members: ['members'] as const,
  invites: ['invites'] as const,
  merchants: ['merchants'] as const,
  cards: ['cards'] as const,
  transactions: (cardId: string) => ['transactions', cardId] as const,
  image: (path: string) => ['image', path] as const,
  balanceCheck: (cardId: string) => ['balanceCheck', cardId] as const,
}

function requireOnline() {
  if (!onlineManager.isOnline()) throw new Error('offline')
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

// ---------------------------------------------------------------- reads

export interface MyHousehold {
  household: Household
  me: Member
}

export function useMyHousehold() {
  const { userId } = useAuth()
  return useQuery({
    queryKey: keys.household(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<MyHousehold | null> => {
      const row = unwrap(
        await supabase
          .from('household_members')
          .select('household_id, user_id, display_name, is_service, households ( id, name )')
          .eq('user_id', userId!)
          .maybeSingle(),
      ) as (Member & { households: Household }) | null
      if (!row) return null
      const { households, ...me } = row
      return { household: households, me }
    },
  })
}

export function useMembers() {
  return useQuery({
    queryKey: keys.members,
    queryFn: async () =>
      unwrap(await supabase.from('household_members').select('household_id, user_id, display_name, is_service').order('joined_at')) as Member[],
  })
}

export function useMerchants() {
  return useQuery({
    queryKey: keys.merchants,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('merchant_summaries').select('*').order('name')) as MerchantSummary[]
      return rows.map((m) => ({
        ...m,
        active_card_count: Number(m.active_card_count),
        total_balance_cents: Number(m.total_balance_cents),
      }))
    },
  })
}

/** All household cards (active and archived) with balances. Small data set; one cache entry. */
export function useCards() {
  return useQuery({
    queryKey: keys.cards,
    queryFn: async (): Promise<CardWithBalance[]> => {
      const [cards, balances] = await Promise.all([
        supabase.from('cards').select('*'),
        supabase.from('card_balances').select('card_id, balance_cents, last_activity_at'),
      ])
      const byId = new Map(
        (unwrap(balances) as { card_id: string; balance_cents: number; last_activity_at: string | null }[]).map((b) => [b.card_id, b]),
      )
      return (unwrap(cards) as Card[]).map((c) => ({
        ...c,
        balance_cents: Number(byId.get(c.id)?.balance_cents ?? 0),
        last_activity_at: byId.get(c.id)?.last_activity_at ?? null,
      }))
    },
  })
}

export function useCard(cardId: string | undefined) {
  const cards = useCards()
  return { ...cards, data: cards.data?.find((c) => c.id === cardId) }
}

export function useTransactions(cardId: string) {
  return useQuery({
    queryKey: keys.transactions(cardId),
    queryFn: async () => {
      const rows = unwrap(
        await supabase.from('transactions').select('*').eq('card_id', cardId).order('created_at', { ascending: false }),
      ) as Transaction[]
      return rows.map((t) => ({ ...t, amount_cents: Number(t.amount_cents) }))
    },
  })
}

export function useInvites() {
  return useQuery({
    queryKey: keys.invites,
    queryFn: async () => unwrap(await supabase.from('household_invites').select('*').order('created_at')) as Invite[],
  })
}

/**
 * Short-lived signed URL for a private barcode image. The service worker caches the
 * image by path (ignoring the token) so it still shows offline.
 */
export function useSignedImageUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: keys.image(path ?? ''),
    enabled: Boolean(path),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path!, 10 * 60)
      if (error) throw error
      return data.signedUrl
    },
  })
}

// ---------------------------------------------------------------- writes

function useInvalidateCards() {
  const qc = useQueryClient()
  return (cardId?: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.cards }),
      qc.invalidateQueries({ queryKey: keys.merchants }),
      cardId ? qc.invalidateQueries({ queryKey: keys.transactions(cardId) }) : null,
    ])
}

export function useRecordTransaction() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: async (v: { cardId: string; type: 'spend' | 'load'; cents: number; note?: string }) => {
      requireOnline()
      unwrap(
        await supabase.from('transactions').insert({
          card_id: v.cardId,
          type: v.type,
          amount_cents: signedAmount(v.type, v.cents),
          note: v.note?.trim() || null,
        }),
      )
    },
    onSuccess: (_d, v) => invalidate(v.cardId),
  })
}

export function useSetBalance() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: async (v: { cardId: string; targetCents: number; note?: string }) => {
      requireOnline()
      return unwrap(
        await supabase.rpc('set_card_balance', {
          p_card_id: v.cardId,
          p_target_cents: v.targetCents,
          p_note: v.note?.trim() || null,
        }),
      ) as number
    },
    onSuccess: (_d, v) => invalidate(v.cardId),
  })
}

export interface CardInput {
  merchantId: string
  label: string
  cardNumber: string
  pin: string
  barcodeFormat: BarcodeFormat | null
  barcodeValue: string | null
  heldBy: string | null
  /** New image to upload (PNG). Omit to keep the current one. */
  image?: Blob | null
  /** Remove the current image. */
  removeImage?: boolean
}

async function uploadImage(householdId: string, image: Blob): Promise<string> {
  const path = `${householdId}/${crypto.randomUUID()}.png`
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, image, { contentType: 'image/png', upsert: false })
  if (error) throw error
  return path
}

async function removeImage(path: string | null | undefined) {
  if (path) await supabase.storage.from(IMAGE_BUCKET).remove([path])
}

export function useCreateCard(householdId: string | undefined) {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: async (v: CardInput & { openingCents: number }): Promise<string> => {
      requireOnline()
      const imagePath = v.image ? await uploadImage(householdId!, v.image) : null
      try {
        return unwrap(
          await supabase.rpc('create_card', {
            p_merchant_id: v.merchantId,
            p_card_number: v.cardNumber,
            p_opening_balance_cents: v.openingCents,
            p_label: v.label,
            p_pin: v.pin,
            p_barcode_format: v.barcodeFormat,
            p_barcode_value: v.barcodeValue,
            p_barcode_image_path: imagePath,
            p_held_by: v.heldBy,
          }),
        ) as string
      } catch (err) {
        await removeImage(imagePath)
        throw err
      }
    },
    onSuccess: () => invalidate(),
  })
}

export function useUpdateCard(card: Card | undefined) {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: async (v: CardInput) => {
      requireOnline()
      if (!card) throw new Error('not_found')
      const newPath = v.image ? await uploadImage(card.household_id, v.image) : null
      const imagePath = newPath ?? (v.removeImage ? null : card.barcode_image_path)
      try {
        unwrap(
          await supabase
            .from('cards')
            .update({
              merchant_id: v.merchantId,
              label: v.label.trim() || null,
              card_number: v.cardNumber.trim(),
              pin: v.pin || null,
              barcode_format: v.barcodeFormat,
              barcode_value: v.barcodeValue,
              barcode_image_path: imagePath,
              held_by: v.heldBy,
            })
            .eq('id', card.id),
        )
      } catch (err) {
        await removeImage(newPath)
        throw err
      }
      if (imagePath !== card.barcode_image_path) await removeImage(card.barcode_image_path)
    },
    onSuccess: () => invalidate(card?.id),
  })
}

export function useSetArchived() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: async (v: { cardId: string; archived: boolean }) => {
      requireOnline()
      unwrap(await supabase.from('cards').update({ archived: v.archived }).eq('id', v.cardId))
    },
    onSuccess: (_d, v) => invalidate(v.cardId),
  })
}

export function useDeleteCard() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: async (card: Card) => {
      requireOnline()
      unwrap(await supabase.from('cards').delete().eq('id', card.id))
      await removeImage(card.barcode_image_path)
    },
    onSuccess: () => invalidate(),
  })
}

export interface MerchantInput {
  name: string
  category: string
  color: string
  balanceCheckUrl: string
  autoCheck: AutoCheckProvider | null
}

function merchantRow(v: MerchantInput) {
  return {
    name: v.name.trim(),
    category: v.category.trim() || 'Other',
    color: v.color,
    balance_check_url: v.balanceCheckUrl.trim() || null,
    auto_check: v.autoCheck,
  }
}

export function useCreateMerchant(householdId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: MerchantInput): Promise<string> => {
      requireOnline()
      const row = unwrap(
        await supabase.from('merchants').insert({ household_id: householdId, ...merchantRow(v) }).select('id').single(),
      ) as { id: string }
      return row.id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.merchants }),
  })
}

export function useUpdateMerchant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: MerchantInput & { id: string }) => {
      requireOnline()
      unwrap(await supabase.from('merchants').update(merchantRow(v)).eq('id', v.id))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.merchants }),
  })
}

export function useDeleteMerchant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      requireOnline()
      unwrap(await supabase.from('merchants').delete().eq('id', id))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.merchants }),
  })
}

export function useCreateHousehold() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { name: string; displayName: string }) => {
      requireOnline()
      return unwrap(await supabase.rpc('create_household', { p_name: v.name, p_display_name: v.displayName })) as string
    },
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useAcceptInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { displayName: string }) => {
      requireOnline()
      return unwrap(await supabase.rpc('accept_household_invite', { p_display_name: v.displayName || null })) as string
    },
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useCreateInvite(householdId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { email: string; displayName: string }) => {
      requireOnline()
      unwrap(
        await supabase.from('household_invites').insert({
          household_id: householdId,
          email: v.email.trim().toLowerCase(),
          display_name: v.displayName.trim(),
        }),
      )
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
  })
}

export function useDeleteInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { householdId: string; email: string }) => {
      requireOnline()
      unwrap(await supabase.from('household_invites').delete().eq('household_id', v.householdId).eq('email', v.email))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
  })
}

export function useUpdateDisplayName() {
  const qc = useQueryClient()
  const { userId } = useAuth()
  return useMutation({
    mutationFn: async (displayName: string) => {
      requireOnline()
      unwrap(await supabase.from('household_members').update({ display_name: displayName.trim() }).eq('user_id', userId!))
    },
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useUpdateHouseholdName() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; name: string }) => {
      requireOnline()
      unwrap(await supabase.from('households').update({ name: v.name.trim() }).eq('id', v.id))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['household'] }),
  })
}

// ---------------------------------------------------------------- automated balance checks

/**
 * Latest automated check for a card. Polls every 2 s while a check is queued or
 * running; when one finishes, refreshes the balance and ledger.
 */
export function useLatestBalanceCheck(cardId: string, enabled: boolean) {
  const invalidate = useInvalidateCards()
  const qc = useQueryClient()
  return useQuery({
    queryKey: keys.balanceCheck(cardId),
    enabled,
    queryFn: async (): Promise<BalanceCheck | null> => {
      const row = unwrap(
        await supabase
          .from('balance_check_requests')
          .select('id, status, result_cents, error_code, created_at, finished_at')
          .eq('card_id', cardId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ) as BalanceCheck | null
      const prev = qc.getQueryData<BalanceCheck | null>(keys.balanceCheck(cardId))
      const justFinished = row?.status === 'done' && prev?.id === row.id && prev.status !== 'done'
      if (justFinished) await invalidate(cardId)
      return row && { ...row, result_cents: row.result_cents === null ? null : Number(row.result_cents) }
    },
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'pending' || s === 'running' ? 2000 : false
    },
    staleTime: 0,
  })
}

export function useRequestBalanceCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cardId: string) => {
      requireOnline()
      return unwrap(await supabase.rpc('request_balance_check', { p_card_id: cardId })) as string
    },
    onSuccess: (_id, cardId) => qc.invalidateQueries({ queryKey: keys.balanceCheck(cardId) }),
  })
}
