import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
      {
        // Migrations + RLS against plain Postgres (TEST_DATABASE_URL). No Docker needed.
        test: {
          name: 'db',
          include: ['supabase/tests/db/**/*.test.ts'],
          environment: 'node',
          // Files share cluster-wide roles; run them one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // RLS + Storage against a real Supabase project (local `supabase start` or the dev project).
        test: {
          name: 'rls',
          include: ['supabase/tests/supabase/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
