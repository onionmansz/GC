import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

// End-to-end RLS + Storage check against a real Supabase stack: local
// `supabase start`, or the *dev* project. Never point this at production:
// it creates and deletes users.
const url = process.env.SUPABASE_TEST_URL
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
const enabled = Boolean(url && anonKey && serviceKey)

const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='),
  (ch) => ch.charCodeAt(0),
)

describe.skipIf(!enabled)('RLS on a live Supabase stack', () => {
  let admin: SupabaseClient
  let member: SupabaseClient
  let outsider: SupabaseClient
  const userIds: string[] = []
  const householdIds: string[] = []
  let cardId: string
  let imagePath: string

  async function signedInClient(email: string): Promise<SupabaseClient> {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (created.error) throw created.error
    userIds.push(created.data.user.id)
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token })
    if (verified.error) throw verified.error
    return client
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const tag = randomUUID().slice(0, 8)
    member = await signedInClient(`rls-member-${tag}@example.com`)
    outsider = await signedInClient(`rls-outsider-${tag}@example.com`)

    const h1 = await member.rpc('create_household', { p_name: 'RLS test', p_display_name: 'Member' })
    if (h1.error) throw h1.error
    householdIds.push(h1.data)
    const h2 = await outsider.rpc('create_household', { p_name: 'RLS other', p_display_name: 'Outsider' })
    if (h2.error) throw h2.error
    householdIds.push(h2.data)

    const merchant = await member.from('merchants').select('id').eq('name', 'Indigo').single()
    if (merchant.error) throw merchant.error

    imagePath = `${h1.data}/${randomUUID()}.png`
    const up = await member.storage.from('card-images').upload(imagePath, PNG_1PX, { contentType: 'image/png' })
    if (up.error) throw up.error

    const card = await member.rpc('create_card', {
      p_merchant_id: merchant.data.id,
      p_card_number: '0000111122223333',
      p_opening_balance_cents: 2000,
      p_barcode_image_path: imagePath,
    })
    if (card.error) throw card.error
    cardId = card.data
  })

  afterAll(async () => {
    if (!admin) return
    if (imagePath) await admin.storage.from('card-images').remove([imagePath])
    if (householdIds.length) await admin.from('households').delete().in('id', householdIds)
    for (const id of userIds) await admin.auth.admin.deleteUser(id)
  })

  it('member can read their card, ledger and image', async () => {
    expect((await member.from('cards').select('id').eq('id', cardId)).data).toHaveLength(1)
    expect((await member.from('transactions').select('id').eq('card_id', cardId)).data).toHaveLength(1)
    const signed = await member.storage.from('card-images').createSignedUrl(imagePath, 60)
    expect(signed.error).toBeNull()
  })

  it('outsider cannot read cards', async () => {
    const res = await outsider.from('cards').select('*').eq('id', cardId)
    expect(res.error).toBeNull()
    expect(res.data).toEqual([])
  })

  it('outsider cannot read transactions or balances', async () => {
    expect((await outsider.from('transactions').select('*').eq('card_id', cardId)).data).toEqual([])
    expect((await outsider.from('card_balances').select('*').eq('card_id', cardId)).data).toEqual([])
  })

  it('outsider cannot read or sign barcode images', async () => {
    const signed = await outsider.storage.from('card-images').createSignedUrl(imagePath, 60)
    expect(signed.data).toBeNull()
    const dl = await outsider.storage.from('card-images').download(imagePath)
    expect(dl.data).toBeNull()
    const list = await outsider.storage.from('card-images').list(householdIds[0])
    expect(list.data ?? []).toEqual([])
  })

  it('outsider cannot write to the card', async () => {
    const ins = await outsider.from('transactions').insert({ card_id: cardId, type: 'spend', amount_cents: -100 })
    expect(ins.error).not.toBeNull()
    const upd = await outsider.from('cards').update({ archived: true }).eq('id', cardId).select()
    expect(upd.data ?? []).toEqual([])
  })

  it('anonymous key alone reads nothing', async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const res = await anon.from('cards').select('*')
    expect(res.data ?? []).toEqual([])
  })
})
