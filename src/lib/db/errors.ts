export type DbErrorFields = {
  code: string;
  message: string;
  details?: string;
  hint?: string;
};

/**
 * Normalised PostgreSQL error. `code` keeps the SQLSTATE so existing
 * `23505` / `42501` / `P0001` branches carry over unchanged.
 */
export class DbError extends Error {
  readonly code: string;
  readonly details?: string;
  readonly hint?: string;

  constructor({ code, message, details, hint }: DbErrorFields) {
    super(message);
    this.name = 'DbError';
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

export function toDbError(error: unknown): DbError {
  if (error instanceof DbError) return error;
  const value = error as { code?: unknown; message?: unknown; detail?: unknown; hint?: unknown } | null;
  const code = typeof value?.code === 'string' && value.code ? value.code : 'DB_ERROR';
  const message = typeof value?.message === 'string' && value.message ? value.message : String(error);
  return new DbError({
    code,
    message,
    details: typeof value?.detail === 'string' ? value.detail : undefined,
    hint: typeof value?.hint === 'string' ? value.hint : undefined,
  });
}

export function isUniqueViolation(error: unknown): boolean {
  return toDbError(error).code === '23505';
}
