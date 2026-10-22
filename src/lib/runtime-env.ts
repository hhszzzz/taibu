/** Server/build-time deployment settings; never derive trust from request headers. */
export function parseConfiguredOrigin(value: string | undefined, name: string): URL {
    if (!value) throw new Error(`Missing ${name} configuration`);
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname.includes('*')
        || (value !== url.origin && value !== `${url.origin}/`)) {
        throw new Error(`${name} must be an HTTP(S) origin without credentials, path, query or fragment`);
    }
    return url;
}

export function shouldSecureAuthCookies(): boolean {
    const origin = parseConfiguredOrigin(process.env.APP_ORIGIN, 'APP_ORIGIN');
    if (process.env.AUTH_ALLOW_INSECURE_LOCAL_HTTP === 'true') {
        if (origin.protocol !== 'http:'
            || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
            throw new Error('Insecure auth cookies require an exact loopback HTTP APP_ORIGIN');
        }
        return false;
    }
    return origin.protocol === 'https:' || process.env.NODE_ENV === 'production';
}
