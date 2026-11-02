/**
 * The base URL of a platform gateway (administrator-configured, OpenAI compatible): the SDKs append `/chat/completions`
 * or `/images/generations` to it.
 *
 * - trailing slashes, a query and a fragment are dropped
 * - a full `/chat/completions` address falls back to its base
 * - `/v1` is added when the path has no version segment; gateways with their own (`/api/paas/v4`, `/v1beta/openai`)
 *   keep it
 *
 * Own models (BYOK) follow their own rules in lib/byok/config.ts.
 */
export function normalizeGatewayBaseUrl(apiUrl: string): string {
    const parsed = new URL(apiUrl.trim());
    parsed.search = '';
    parsed.hash = '';

    let pathname = parsed.pathname.replace(/\/+$/u, '');

    if (pathname.endsWith('/v1/chat/completions')) {
        pathname = pathname.replace(/\/v1\/chat\/completions$/u, '/v1');
    } else if (pathname.endsWith('/chat/completions')) {
        pathname = pathname.replace(/\/chat\/completions$/u, '');
    }

    if (!/\/v\d+/u.test(pathname)) {
        pathname = `${pathname || ''}/v1`;
    }

    parsed.pathname = pathname;
    return parsed.toString().replace(/\/$/u, '');
}
