/**
 * Linux DO Connect OAuth2 协议封装
 *
 * 支持 PKCE (S256)、授权码流程、token 交换、userinfo 获取
 */
import { randomBytes, createHash } from 'crypto';

const AUTHORIZE_URL = 'https://connect.linux.do/oauth2/authorize';
const TOKEN_URLS = [
  'https://connect.linux.do/oauth2/token',
  'https://connect.linuxdo.org/oauth2/token',
] as const;
const USERINFO_URLS = [
  'https://connect.linux.do/api/user',
  'https://connect.linuxdo.org/api/user',
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function getClientId(): string {
  return requireEnv('LINUXDO_CLIENT_ID');
}

function getClientSecret(): string {
  return requireEnv('LINUXDO_CLIENT_SECRET');
}

// --- PKCE helpers ---

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return randomBytes(32).toString('hex');
}

export function normalizeLinuxDoReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }

  try {
    const parsed = new URL(value, 'http://localhost');
    if (parsed.origin !== 'http://localhost') {
      return '/';
    }

    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return normalized || '/';
  } catch {
    return '/';
  }
}

// --- URL builder ---

export function buildAuthUrl(state: string, codeChallenge: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// --- Token exchange ---

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
}

async function readErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return 'unknown error';
  }
}

function shouldRetryEndpoint(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export async function exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    code_verifier: codeVerifier,
  });

  const errors: string[] = [];

  for (const [index, url] of TOKEN_URLS.entries()) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        return res.json() as Promise<TokenResponse>;
      }

      const text = await readErrorText(res);
      errors.push(`${url} -> ${res.status}: ${text}`);
      const hasFallback = index < TOKEN_URLS.length - 1;
      if (!hasFallback || !shouldRetryEndpoint(res.status)) {
        break;
      }
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      if (index === TOKEN_URLS.length - 1) {
        break;
      }
    }
  }

  throw new Error(`Token exchange failed: ${errors.join(' | ')}`);
}

// --- UserInfo ---

interface LinuxDoUserRaw {
  sub?: string;
  username?: string;
  preferred_username?: string;
  login?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  avatar_url?: string;
  picture?: string;
  groups?: string[];
  active?: boolean;
  trust_level?: number;
  silenced?: boolean;
}

export interface LinuxDoUser {
  sub: string;
  preferred_username: string;
  name: string;
  email: string;
  email_verified?: boolean;
  groups?: string[];
  picture?: string;
  username?: string;
  avatar_url?: string;
  active?: boolean;
  trust_level?: number;
  silenced?: boolean;
}

export function normalizeLinuxDoUser(raw: LinuxDoUserRaw): LinuxDoUser {
  const sub = raw.sub?.trim();
  const preferredUsername = raw.preferred_username?.trim()
    || raw.username?.trim()
    || raw.login?.trim();
  const email = raw.email?.trim();
  const name = raw.name?.trim() || preferredUsername;

  if (!sub) {
    throw new Error('UserInfo payload missing sub');
  }
  if (!preferredUsername) {
    throw new Error('UserInfo payload missing preferred username');
  }
  if (!email) {
    throw new Error('UserInfo payload missing email');
  }

  return {
    ...raw,
    sub,
    preferred_username: preferredUsername,
    name: name || preferredUsername,
    email,
    email_verified: typeof raw.email_verified === 'boolean' ? raw.email_verified : undefined,
    picture: raw.picture || raw.avatar_url,
  };
}

export async function fetchUserInfo(accessToken: string): Promise<LinuxDoUser> {
  const errors: string[] = [];

  for (const [index, url] of USERINFO_URLS.entries()) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const payload = await res.json() as LinuxDoUserRaw;
        return normalizeLinuxDoUser(payload);
      }

      const text = await readErrorText(res);
      errors.push(`${url} -> ${res.status}: ${text}`);
      const hasFallback = index < USERINFO_URLS.length - 1;
      if (!hasFallback || !shouldRetryEndpoint(res.status)) {
        break;
      }
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      if (index === USERINFO_URLS.length - 1) {
        break;
      }
    }
  }

  throw new Error(`UserInfo request failed: ${errors.join(' | ')}`);
}
