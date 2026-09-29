import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', 'migrations')

/** Superuser connection string to a throwaway Postgres >= 15. */
export const adminUrl = process.env.TEST_DATABASE_URL

export interface TestDb {
  /** Superuser client (bypasses RLS) for arranging fixtures. */
  admin: pg.Client
  /** Run `fn` as an authenticated Supabase user, inside a transaction that is committed. */
  as<T>(user: TestUser | null, fn: (c: pg.Client) => Promise<T>): Promise<T>
  createUser(email: string): Promise<TestUser>
  close(): Promise<void>
}

export interface TestUser {
  id: string
  email: string
}

/** Creates a fresh database, applies the Supabase shim and every migration in order. */
export async function createTestDb(): Promise<TestDb> {
  if (!adminUrl) throw new Error('TEST_DATABASE_URL is not set')
  const name = `wallet_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`

  const root = new pg.Client({ connectionString: adminUrl })
  await root.connect()
  await root.query(`create database ${name}`)
  await root.end()

  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const admin = new pg.Client({ connectionString: url.toString() })
  await admin.connect()
  await admin.query(readFileSync(join(here, 'supabase-shim.sql'), 'utf8'))
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(migrationsDir, file), 'utf8'))
  }

  const userClient = new pg.Client({ connectionString: url.toString() })
  await userClient.connect()

  return {
    admin,
    async as(user, fn) {
      await userClient.query('begin')
      try {
        await userClient.query(`set local role ${user ? 'authenticated' : 'anon'}`)
        const claims = user ? { sub: user.id, email: user.email, role: 'authenticated' } : { role: 'anon' }
        await userClient.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
        const result = await fn(userClient)
        await userClient.query('commit')
        return result
      } catch (err) {
        await userClient.query('rollback')
        throw err
      }
    },
    async createUser(email) {
      const { rows } = await admin.query<{ id: string }>(
        'insert into auth.users (email) values ($1) returning id',
        [email],
      )
      return { id: rows[0].id, email }
    },
    async close() {
      await userClient.end()
      await admin.end()
      const r = new pg.Client({ connectionString: adminUrl })
      await r.connect()
      await r.query(`drop database if exists ${name} with (force)`)
      await r.end()
    },
  }
}
