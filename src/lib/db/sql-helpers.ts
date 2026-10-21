import { sql, type Expression } from 'kysely';

/** pg encodes a JS array as a PostgreSQL array literal; jsonb must be JSON text. */
export function json(value: unknown): Expression<unknown> {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** Escape user input before ILIKE: backslash, percent and underscore. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
