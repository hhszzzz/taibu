import 'server-only';

import type { Redis } from 'ioredis';
import { getRedisClient } from '@/lib/redis.server';

const PREFIX = 'taibu:auth:';

const INCREMENT_WITH_TTL = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return value
`;

/**
 * Better Auth secondary storage for sessions, OTPs and rate limiting.
 * Values are opaque strings; Redis may lose them at any time.
 */
export const authSecondaryStorage = {
  async get(key: string): Promise<string | null> {
    return getRedisClient().get(`${PREFIX}${key}`);
  },
  async getAndDelete(key: string): Promise<string | null> {
    return getRedisClient().getdel(`${PREFIX}${key}`);
  },
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const client: Redis = getRedisClient();
    const value = await client.eval(INCREMENT_WITH_TTL, 1, `${PREFIX}${key}`, String(ttlSeconds * 1000));
    return Number(value);
  },
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = getRedisClient();
    if (ttlSeconds) await client.set(`${PREFIX}${key}`, value, 'EX', ttlSeconds);
    else await client.set(`${PREFIX}${key}`, value);
  },
  async delete(key: string): Promise<void> {
    await getRedisClient().del(`${PREFIX}${key}`);
  },
};
