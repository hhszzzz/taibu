import { isSelfHosted, parseConfiguredOrigin } from './runtime-env';

/** Browser-facing origin is mandatory in self-hosted mode to avoid leaking gateway DNS. */
export function getSupabasePublicUrl(): string {
    if (!isSelfHosted()) return getSupabaseUrl();
    return parseConfiguredOrigin(process.env.SUPABASE_PUBLIC_URL, 'SUPABASE_PUBLIC_URL').origin;
}

export function getSupabaseUrl(): string {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
    if (!url) {
        throw new Error('Missing Supabase URL configuration (SUPABASE_URL)');
    }
    return url;
}

export function getSupabaseAnonKey(): string {
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
    if (!anonKey) {
        throw new Error('Missing Supabase anon key configuration (SUPABASE_ANON_KEY)');
    }
    return anonKey;
}

export function getSupabaseAuthAdminKey(): string | null {
    return process.env.SUPABASE_SECRET_KEY || null;
}
