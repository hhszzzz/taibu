/** Runtime validation shared by SDK calculations and protocol adapters. */
export class CoreInputError extends RangeError {
  readonly code: string;
  readonly path: string;

  constructor(path: string, message: string, code = 'INVALID_INPUT') {
    super(`${path ? `${path} ` : ''}${message}`);
    this.name = 'CoreInputError';
    this.code = code;
    this.path = path;
  }
}

export function assertInteger(value: unknown, path: string, minimum: number, maximum: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CoreInputError(path, `必须为 ${minimum}–${maximum} 范围内的安全整数`);
  }
}

export function assertFiniteNumber(value: unknown, path: string, minimum: number, maximum: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CoreInputError(path, `必须为 ${minimum}–${maximum} 范围内的有限数值`);
  }
}

export function resolveEnum<T extends string>(value: unknown, choices: readonly T[], fallback: T, path: string): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new CoreInputError(path, `无效，允许值为 ${choices.join(', ')}`);
  }
  return value as T;
}

/** 非空的枚举数组：去重并保留首次出现的顺序；省略时返回 undefined */
export function resolveEnumList<T extends string>(value: unknown, choices: readonly T[], path: string): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new CoreInputError(path, '须为非空数组');
  const invalid = value.findIndex((item) => typeof item !== 'string' || !choices.includes(item as T));
  if (invalid >= 0) throw new CoreInputError(`${path}[${invalid}]`, `无效值 ${String(value[invalid])}，允许值为 ${choices.join(', ')}`);
  return [...new Set(value as T[])];
}

export type CivilDateTime = {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
};

export function validateCivilDateTime(input: CivilDateTime, path = 'date'): void {
  assertInteger(input.year, `${path}.year`, 1, 9999);
  assertInteger(input.month, `${path}.month`, 1, 12);
  const leap = input.year % 4 === 0 && (input.year % 100 !== 0 || input.year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!Number.isSafeInteger(input.day) || input.day < 1 || input.day > monthDays[input.month - 1]) {
    throw new CoreInputError(path, '日期无效，请检查日期是否存在');
  }
  assertInteger(input.hour ?? 0, `${path}.hour`, 0, 23);
  assertInteger(input.minute ?? 0, `${path}.minute`, 0, 59);
  assertInteger(input.second ?? 0, `${path}.second`, 0, 59);
}

/** Date.UTC remaps years 0–99; setUTCFullYear preserves the specified year.
 * Only trusted Intl-derived fields may skip validation when timezone sampling crosses the input year range. */
export function createUtcDateTime(input: CivilDateTime, validateInput = true): Date {
  if (validateInput) validateCivilDateTime(input);
  const date = new Date(0);
  date.setUTCFullYear(input.year, input.month - 1, input.day);
  date.setUTCHours(input.hour ?? 0, input.minute ?? 0, input.second ?? 0, 0);
  return date;
}

export function parseCivilDate(value: unknown, path = 'date'): CivilDateTime & { hour: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CoreInputError(path, '格式无效，请使用 YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const result = { year, month, day, hour: 0 };
  validateCivilDateTime(result, path);
  return result;
}
