export function hasNonEmptyStrings(
    obj: Record<string, unknown>,
    fields: string[]
): boolean {
    return fields.every((field) => {
        const value = obj[field];
        return typeof value === 'string' && value.trim().length > 0;
    });
}

export function missingFields(
    obj: Record<string, unknown>,
    fields: string[]
): string[] {
    return fields.filter((field) => {
        const value = obj[field];
        if (value === undefined || value === null) return true;
        if (typeof value === 'string') return value.trim().length === 0;
        return false;
    });
}

export function missingSearchParams(
    params: URLSearchParams,
    fields: string[]
): string[] {
    return fields.filter((field) => {
        const value = params.get(field);
        return !value || value.trim().length === 0;
    });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
    return UUID_RE.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
