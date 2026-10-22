import 'server-only';
import Redis from 'ioredis';

/**
 * Shared Redis client for cache, login-failure locks and Better Auth's
 * secondary storage (P5). Rate limiting keeps its own fail-fast client.
 */
let sharedClient: Redis | null = null;

function requireRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('Missing Redis configuration (REDIS_URL)');
  return url;
}

export function getRedisClient(): Redis {
  if (sharedClient) return sharedClient;
  const client = new Redis(requireRedisUrl(), {
    // Never log connection errors: the URL may embed credentials.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  client.on('error', () => {});
  sharedClient = client;
  return client;
}

/** Dedicated subscription connection; Redis forbids regular commands while subscribed. */
export function createSubscriber(): Redis {
  return getRedisClient().duplicate();
}

/**
 * BullMQ needs a connection that queues commands while Redis is unreachable.
 * BullMQ owns this client once handed to a Queue/Worker.
 */
export function createBullConnection(): Redis {
  return new Redis(requireRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Redis ping timeout')), timeoutMs);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Readiness probe; bounded so a hung Redis cannot stall the health route. */
export async function pingRedis(timeoutMs = 2000): Promise<boolean> {
  try {
    return await withTimeout(getRedisClient().ping(), timeoutMs) === 'PONG';
  } catch {
    return false;
  }
}
