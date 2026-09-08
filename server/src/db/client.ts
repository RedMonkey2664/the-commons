/**
 * Store selection.
 *
 * One decision, made once at boot, from the environment:
 *   DATABASE_URL set  -> Postgres (02's production target, via Supabase)
 *   otherwise         -> JSON file store
 *
 * Callers receive a Store and never learn which. That is what allows the whole
 * of Phase 3 to be built and played before a database exists, and for adding
 * one later to be a config change rather than a refactor.
 */

import type { Store } from '@commons/shared';
import { JsonStore } from './jsonStore.js';
import { PostgresStore } from './postgresStore.js';

let store: Store | undefined;

export async function initStore(): Promise<Store> {
  if (store) return store;

  const url = process.env['DATABASE_URL']?.trim();

  if (url) {
    const postgres = new PostgresStore(url);
    try {
      await postgres.init();
      store = postgres;
      console.log('[db] using Postgres');
      return store;
    } catch (error) {
      // Release the half-open pool before falling back; otherwise its retry
      // timers keep the process alive and reconnecting in the background.
      await postgres.close().catch(() => undefined);
      // Falling back rather than exiting is deliberate: a database that is
      // briefly unreachable should degrade the game to local persistence, not
      // stop friends being able to hang out. The warning is loud on purpose.
      console.warn(
        `[db] DATABASE_URL is set but the connection failed (${(error as Error).message}).`,
      );
      console.warn('[db] falling back to the local JSON store — data will NOT go to Postgres.');
    }
  }

  const json = new JsonStore();
  await json.init();
  store = json;
  console.log(
    url
      ? '[db] using local JSON store (Postgres unavailable)'
      : '[db] using local JSON store (set DATABASE_URL for Postgres)',
  );
  return store;
}

export function getStore(): Store {
  if (!store) throw new Error('Store used before initStore()');
  return store;
}

export async function closeStore(): Promise<void> {
  await store?.close();
  store = undefined;
}
