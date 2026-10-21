import { loadConfig } from './config';
import { MemoryStore } from './store-memory';
import { PostgresStore } from './store-postgres';
import type { Store } from './store';

let storePromise: Promise<Store> | null = null;

/**
 * The store is created once per server instance and reused.
 *
 * A serverless function keeps a warm instance between requests, so this
 * avoids reconnecting on every call while still allowing the instance to be
 * recycled at any time.
 */
export async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = createStore().catch((error: unknown) => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

async function createStore(): Promise<Store> {
  const config = loadConfig();
  if (config.storeDriver === 'postgres') {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL is required when DB_DRIVER=postgres.');
    }
    return new PostgresStore(connectionString);
  }
  console.warn(
    '[tap-rush] No DATABASE_URL found, using the in-memory store. Scores will not persist.',
  );
  return new MemoryStore();
}
