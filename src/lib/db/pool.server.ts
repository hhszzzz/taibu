import 'server-only';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from './generated/schema';

const { Pool, types } = pg;

const OID = {
  timestamptz: 1184,
  timestamp: 1114,
  date: 1082,
  int8: 20,
  numeric: 1700,
  timestamptzArray: 1185,
  timestampArray: 1115,
  dateArray: 1182,
  int8Array: 1016,
  numericArray: 1231,
} as const;

/**
 * PostgREST renders a timestamptz as `2026-10-21T03:08:25.25+00:00`.
 * Sessions run with TimeZone=UTC; we only reformat the server's text.
 */
export function parseTimestamp(value: string): string {
  if (value === 'infinity' || value === '-infinity') return value;
  const match = /^(\d{4,}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,6})?(?:([+-])(\d{2})(?::?(\d{2}))?)?$/.exec(value);
  if (!match) return value.replace(' ', 'T');
  const [, date, time, fraction = '', sign, hours, minutes] = match;
  const offset = sign ? `${sign}${hours}:${minutes ?? '00'}` : '';
  return `${date}T${time}${fraction}${offset}`;
}

export function parseNumber(value: string): number {
  return Number(value);
}

/** Text-format array with quoted elements, backslash escapes and NULL. */
export function parseTextArray<T>(value: string, parseElement: (element: string) => T): (T | null)[] | null {
  const source = value.trim();
  if (source === '{}') return [];
  if (!source.startsWith('{') || !source.endsWith('}')) return null;
  const result: (T | null)[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const character of source.slice(1, -1)) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === ',' && !quoted) {
      result.push(current === 'NULL' ? null : parseElement(current));
      current = '';
      continue;
    }
    current += character;
  }
  result.push(current === 'NULL' ? null : parseElement(current));
  return result;
}

const scalarParsers: Record<number, (value: string) => unknown> = {
  [OID.timestamptz]: parseTimestamp,
  [OID.timestamp]: parseTimestamp,
  [OID.date]: (value) => value,
  [OID.int8]: parseNumber,
  [OID.numeric]: parseNumber,
  [OID.timestamptzArray]: (value) => parseTextArray(value, parseTimestamp),
  [OID.timestampArray]: (value) => parseTextArray(value, parseTimestamp),
  [OID.dateArray]: (value) => parseTextArray(value, (element) => element),
  [OID.int8Array]: (value) => parseTextArray(value, parseNumber),
  [OID.numericArray]: (value) => parseTextArray(value, parseNumber),
};

const customTypes = {
  getTypeParser(oid: number, format: string = 'text') {
    if (format !== 'text') return types.getTypeParser(oid, format as 'binary');
    return scalarParsers[oid] ?? types.getTypeParser(oid, 'text');
  },
};

export function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('[db] DATABASE_URL 未配置');
  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? '10'),
    application_name: process.env.DB_APPLICATION_NAME ?? 'taibu',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    types: customTypes as pg.CustomTypesConfig,
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __taibuDbPool: pg.Pool | undefined;
  // eslint-disable-next-line no-var
  var __taibuKysely: Kysely<DB> | undefined;
}

/**
 * Better Auth needs its own small pool on the `taibu_auth` role. It keeps the
 * default type parsers because the auth tables store plain strings/booleans.
 */
export function createAuthPool(): pg.Pool {
  const connectionString = process.env.AUTH_DATABASE_URL;
  if (!connectionString) throw new Error('[db] AUTH_DATABASE_URL 未配置');
  return new Pool({
    connectionString,
    max: 4,
    application_name: 'taibu-auth',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
  });
}

export function getPool(): pg.Pool {
  globalThis.__taibuDbPool ??= createPool();
  return globalThis.__taibuDbPool;
}

/** Only src/lib/db composes SQL; business modules use ScopedDb. */
export function rootDb(): Kysely<DB> {
  globalThis.__taibuKysely ??= new Kysely<DB>({
    dialect: new PostgresDialect({ pool: getPool() }),
  });
  return globalThis.__taibuKysely;
}

export async function closeDb(): Promise<void> {
  const db = globalThis.__taibuKysely;
  const pool = globalThis.__taibuDbPool;
  globalThis.__taibuKysely = undefined;
  globalThis.__taibuDbPool = undefined;
  // Kysely's PostgresDialect owns the supplied pool and ends it in destroy().
  if (db) await db.destroy();
  else await pool?.end();
}
