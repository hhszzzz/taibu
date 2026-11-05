import 'server-only';

import { createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { revokeUnprovenAccountAccess } from 'better-auth/db';
import { setSessionCookie } from 'better-auth/cookies';
import { systemDb } from '@/lib/db/context.server';
import { ensureUserRecordRow } from '@/lib/user/profile-record';
import {
  buildAuthUrl,
  exchangeCode,
  fetchUserInfo,
  generatePKCE,
  generateState,
  normalizeLinuxDoReturnTo,
  type LinuxDoUser,
} from '@/lib/oauth/linuxdo';
import { parseConfiguredOrigin } from '@/lib/runtime-env';

const OAUTH_STATE_COOKIE = 'linuxdo-oauth-state';
const PROVIDER_ID = 'linuxdo';

type OAuthStatePayload = {
  state: string;
  codeVerifier: string;
  returnTo: string;
};

function appOrigin(ctx: { context: { baseURL: string } }): string {
  const configured = process.env.APP_ORIGIN;
  if (configured) return parseConfiguredOrigin(configured, 'APP_ORIGIN').origin;
  return new URL(ctx.context.baseURL).origin;
}

function parseStateCookie(value: string | null | undefined): OAuthStatePayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as OAuthStatePayload;
    if (typeof parsed.state !== 'string' || typeof parsed.codeVerifier !== 'string') return null;
    return {
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      returnTo: normalizeLinuxDoReturnTo(parsed.returnTo),
    };
  } catch {
    return null;
  }
}

function resultUrl(origin: string, returnTo: string, params: Record<string, string | null | undefined>): URL {
  const url = new URL(normalizeLinuxDoReturnTo(returnTo), origin);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

function callbackUrl(origin: string): string {
  return new URL('/api/auth/linuxdo/callback', origin).toString();
}

async function rememberProvider(userId: string, user: LinuxDoUser, nickname: string): Promise<void> {
  const metadata = {
    linuxdo_sub: user.sub,
    linuxdo_username: user.preferred_username,
    linuxdo_trust_level: user.trust_level ?? null,
    linuxdo_groups: user.groups ?? [],
  };
  const db = systemDb();
  await db.tx((trx) => trx
    .insertInto('user_oauth_providers')
    .values({
      user_id: userId,
      provider: PROVIDER_ID,
      provider_user_id: user.sub,
      provider_email: user.email,
      provider_username: user.preferred_username,
      provider_avatar_url: user.picture ?? null,
      provider_metadata: metadata,
    })
    .onConflict((conflict) => conflict.columns(['provider', 'provider_user_id']).doUpdateSet({
      provider_email: user.email,
      provider_username: user.preferred_username,
      provider_avatar_url: user.picture ?? null,
      provider_metadata: metadata,
    }))
    .execute());
  const ensured = await ensureUserRecordRow(db, { id: userId, name: nickname, image: user.picture ?? null });
  if (!ensured.ok) throw ensured.error;
  // Only fill the mirrored avatar when the user has not chosen one yet.
  if (user.picture) {
    await db.tx((trx) => trx
      .updateTable('users')
      .set({ avatar_url: user.picture ?? null })
      .where('id', '=', userId)
      .where('avatar_url', 'is', null)
      .execute());
  }
}

async function resolveUser(ctx: Parameters<typeof getSessionFromCtx>[0], sub: string, user: LinuxDoUser, accessToken: string) {
  const owner = await ctx.context.internalAdapter.findAccountOwnerByKey({
    providerId: PROVIDER_ID,
    accountId: sub,
  });
  if (owner?.kind === 'owned') return owner.user;

  const byEmail = await ctx.context.internalAdapter.findUserByEmail(user.email.toLowerCase());
  if (byEmail) {
    // A row whose address was never proven may carry a password or link that
    // someone else chose. Linux.do has proven this mailbox, so drop that access
    // before promoting the row, exactly as an email OTP login does.
    if (!byEmail.user.emailVerified) await revokeUnprovenAccountAccess(ctx, byEmail.user.id);
    await ctx.context.internalAdapter.linkAccount({
      providerId: PROVIDER_ID,
      accountId: sub,
      userId: byEmail.user.id,
      accessToken,
      scope: 'openid profile email',
    });
    return byEmail.user;
  }

  const created = await ctx.context.internalAdapter.createUser({
    email: user.email.toLowerCase(),
    emailVerified: true,
    name: user.name || user.preferred_username || '命理爱好者',
    image: user.picture ?? null,
  }, { method: PROVIDER_ID });
  await ctx.context.internalAdapter.linkAccount({
    providerId: PROVIDER_ID,
    accountId: sub,
    userId: created.id,
    accessToken,
    scope: 'openid profile email',
  });
  return created;
}

export function linuxdoPlugin() {
  return {
    id: 'linuxdo',
    endpoints: {
      linuxdoStart: createAuthEndpoint('/linuxdo', { method: 'GET' }, async (ctx) => {
        const url = new URL(ctx.request?.url ?? `${ctx.context.baseURL}/linuxdo`);
        const origin = appOrigin(ctx);
        const returnTo = normalizeLinuxDoReturnTo(url.searchParams.get('returnTo'));

        const state = generateState();
        const { codeVerifier, codeChallenge } = generatePKCE();
        const payload: OAuthStatePayload = { state, codeVerifier, returnTo };

        await ctx.setSignedCookie(OAUTH_STATE_COOKIE, JSON.stringify(payload), ctx.context.secret, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 600,
          secure: ctx.context.options.advanced?.useSecureCookies ?? true,
        });

        const redirectUri = callbackUrl(origin);
        throw ctx.redirect(buildAuthUrl(state, codeChallenge, redirectUri));
      }),

      linuxdoCallback: createAuthEndpoint('/linuxdo/callback', { method: 'GET' }, async (ctx) => {
        const url = new URL(ctx.request?.url ?? `${ctx.context.baseURL}/linuxdo`);
        const origin = appOrigin(ctx);
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const oauthError = url.searchParams.get('error');
        const signedCookie = await ctx.getSignedCookie(OAUTH_STATE_COOKIE, ctx.context.secret);
        const rawCookie = typeof signedCookie === 'string' ? signedCookie : null;
        const stateCookie = parseStateCookie(rawCookie);
        const fallbackReturnTo = stateCookie?.returnTo ?? '/';
        const clearState = () => ctx.setCookie(OAUTH_STATE_COOKIE, '', { path: '/', maxAge: 0 });

        if (oauthError) {
          await clearState();
          throw ctx.redirect(resultUrl(origin, fallbackReturnTo, { error: 'oauth_denied' }).toString());
        }
        if (!code || !returnedState) {
          await clearState();
          throw ctx.redirect(resultUrl(origin, fallbackReturnTo, { error: 'missing_params' }).toString());
        }
        if (!rawCookie) {
          throw ctx.redirect(resultUrl(origin, '/', { error: 'missing_state' }).toString());
        }
        if (!stateCookie) {
          await clearState();
          throw ctx.redirect(resultUrl(origin, '/', { error: 'invalid_state' }).toString());
        }

        const redirectCurrentError = async (error: string) => {
          await clearState();
          throw ctx.redirect(resultUrl(origin, stateCookie.returnTo, { error }).toString());
        };

        if (returnedState !== stateCookie.state) return redirectCurrentError('state_mismatch');

        const redirectUri = callbackUrl(origin);
        let accessToken: string;
        try {
          const token = await exchangeCode(code, stateCookie.codeVerifier, redirectUri);
          accessToken = token.access_token;
        } catch (error) {
          console.error('[linuxdo] token exchange failed:', error);
          return redirectCurrentError('token_exchange_failed');
        }

        let linuxdoUser: LinuxDoUser;
        try {
          linuxdoUser = await fetchUserInfo(accessToken);
        } catch (error) {
          console.error('[linuxdo] userinfo failed:', error);
          return redirectCurrentError('userinfo_failed');
        }
        if (linuxdoUser.email_verified === false) return redirectCurrentError('email_not_verified');

        const nickname = linuxdoUser.name || linuxdoUser.preferred_username || '命理爱好者';
        let user;
        try {
          user = await resolveUser(ctx, linuxdoUser.sub, linuxdoUser, accessToken);
        } catch (error) {
          console.error('[linuxdo] account resolution failed:', error);
          return redirectCurrentError('account_link_failed');
        }
        if (!user) return redirectCurrentError('user_not_found');

        try {
          await rememberProvider(user.id, linuxdoUser, nickname);
        } catch (error) {
          console.error('[linuxdo] provider snapshot failed:', error);
          return redirectCurrentError('provider_lookup_failed');
        }

        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) return redirectCurrentError('session_failed');
        await setSessionCookie(ctx, { session, user });
        await clearState();
        throw ctx.redirect(resultUrl(origin, stateCookie.returnTo, {}).toString());
      }),
    },
  };
}
