import 'server-only';

import { createMemoryCache, createSingleFlight } from './memory';
import { createSubscriber, getRedisClient } from '@/lib/redis.server';

const KEY_PREFIX = 'taibu:cache:v1:';
const INVALIDATE_CHANNEL = 'taibu:cache:invalidate';
const REDIS_TIMEOUT_MS = 500;

const invalidateListeners = new Map<string, () => void>();
let subscriberStarting: Promise<void> | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Redis cache timeout')), timeoutMs);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** One process-wide subscriber clears every registered L1 when any process invalidates. */
function ensureInvalidateSubscriber(): void {
  if (subscriberStarting) return;
  subscriberStarting = (async () => {
    try {
      const subscriber = createSubscriber();
      subscriber.on('message', (channel, name) => {
        if (channel === INVALIDATE_CHANNEL) invalidateListeners.get(name)?.();
      });
      subscriber.on('error', () => {});
      await subscriber.subscribe(INVALIDATE_CHANNEL);
    } catch (error) {
      // Redis down: L1 still works and expires on its own TTL.
      console.warn('[cache] invalidation subscriber unavailable:', messageOf(error));
      subscriberStarting = null;
    }
  })();
}

export type SharedCache<T> = {
  /** L1 -> Redis L2 -> loader. Redis failures degrade to the loader. */
  load(loader: () => Promise<T>): Promise<T>;
  /** Drop both levels locally and notify the other processes. */
  invalidate(): Promise<void>;
};

export function createSharedCache<T>(options: { name: string; ttlMs: number }): SharedCache<T> {
  const { name, ttlMs } = options;
  const key = `${KEY_PREFIX}${name}`;
  const memory = createMemoryCache<T>(ttlMs, 32);
  const flight = createSingleFlight<T>();

  invalidateListeners.set(name, () => {
    memory.remove(key);
    flight.clear(name);
  });
  ensureInvalidateSubscriber();

  return {
    async load(loader) {
      const local = memory.get(key);
      if (local !== null) return local;

      return flight.run(name, async () => {
        const second = memory.get(key);
        if (second !== null) return second;

        try {
          const raw = await withTimeout(getRedisClient().get(key), REDIS_TIMEOUT_MS);
          if (raw !== null) {
            try {
              const parsed = JSON.parse(raw) as { value: T };
              memory.set(key, parsed.value);
              return parsed.value;
            } catch {
              await getRedisClient().del(key).catch(() => undefined);
            }
          }
        } catch {
          // Cache miss / Redis outage: fall through to the loader.
        }

        const value = await loader();
        memory.set(key, value);
        try {
          await withTimeout(
            getRedisClient().set(key, JSON.stringify({ value }), 'PX', ttlMs),
            REDIS_TIMEOUT_MS,
          );
        } catch {
          // L1-only caching is acceptable; the next miss reloads.
        }
        return value;
      });
    },

    async invalidate() {
      memory.remove(key);
      flight.clear(name);
      try {
        const redis = getRedisClient();
        await withTimeout(redis.del(key), REDIS_TIMEOUT_MS);
        await withTimeout(redis.publish(INVALIDATE_CHANNEL, name), REDIS_TIMEOUT_MS);
      } catch (error) {
        console.warn('[cache] invalidate failed:', messageOf(error));
      }
    },
  };
}
