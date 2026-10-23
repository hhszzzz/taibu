import 'server-only';

import { createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
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
import type { MembershipType } from '@/lib/user/membership';
import { parseConfiguredOrigin } from '@/lib/runtime-env';

const OAUTH_STATE_COOKIE = 'linuxdo-oauth-state';
const CLAIM_INTENT = 'membership-claim';
const PROVIDER_ID = 'linuxdo';

type OAuthStatePayload = {
  state: string;
  codeVerifier: string;
  intent: string;
  returnTo: string;
  claimUserId?: string;
  claimSub?: string;
};

type ClaimResult = {
  status?: string;
  next_available_at?: string | null;
} | null;

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
      intent: parsed.intent === CLAIM_INTENT ? CLAIM_INTENT : 'login',
      returnTo: normalizeLinuxDoReturnTo(parsed.returnTo),
      ...(typeof parsed.claimUserId === 'string' ? { claimUserId: parsed.claimUserId } : {}),
      ...(typeof parsed.claimSub === 'string' ? { claimSub: parsed.claimSub } : {}),
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

function resolveLinuxDoMembership(user: LinuxDoUser): MembershipType | null {
  if (typeof user.trust_level !== 'number') return null;
  if (user.trust_level >= 3) return 'pro';
  if (user.trust_level === 2) return 'plus';
  return null;
}

async function boundProvider(userId: string): Promise<{ provider_user_id: string } | null> {
  const row = await systemDb().tx((trx) => trx
    .selectFrom('user_oauth_providers')
    .select(['provider_user_id'])
    .where('user_id', '=', userId)
    .where('provider', '=', PROVIDER_ID)
    .executeTakeFirst());
  return row ?? null;
}

async function rememberProvider(userId: string, user: LinuxDoUser, nickname: string): Promise<void> {
  const metadata = {
    linuxdo_sub: user.sub,
    linuxdo_username: user.preferred_username,
    linuxdo_trust_level: user.trust_level ?? null,
    linuxdo_groups: user.groups ?? [],
  };
  await systemDb().tx((trx) => trx
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
  const ensured = await ensureUserRecordRow(systemDb(), { id: userId, name: nickname, image: user.picture ?? null });
  if (!ensured.ok) throw ensured.error;
  // Only fill the mirrored avatar when the user has not chosen one yet.
  if (user.picture) {
    await systemDb().tx((trx) => trx
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
        const intent = url.searchParams.get('intent') === CLAIM_INTENT ? CLAIM_INTENT : 'login';
        const returnTo = normalizeLinuxDoReturnTo(url.searchParams.get('returnTo'));

        const state = generateState();
        const { codeVerifier, codeChallenge } = generatePKCE();
        const payload: OAuthStatePayload = { state, codeVerifier, intent, returnTo };

        if (intent === CLAIM_INTENT) {
          const authState = await getSessionFromCtx(ctx).catch(() => null);
          const bound = authState?.user ? await boundProvider(authState.user.id) : null;
          if (!authState?.user || !bound) {
            throw ctx.redirect(resultUrl(origin, returnTo, { claim: 'missing_linuxdo' }).toString());
          }
          payload.claimUserId = authState.user.id;
          payload.claimSub = bound.provider_user_id;
        }

        await ctx.setSignedCookie(OAUTH_STATE_COOKIE, JSON.stringify(payload), ctx.context.secret, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 600,
          secure: ctx.context.options.advanced?.useSecureCookies ?? true,
        });

        const redirectUri = new URL('/api/auth/linuxdo/callback', origin).toString();
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

        const redirectUri = new URL('/api/auth/linuxdo/callback', origin).toString();
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

        if (stateCookie.intent !== CLAIM_INTENT) {
          throw ctx.redirect(resultUrl(origin, stateCookie.returnTo, {}).toString());
        }

        const claimUserId = stateCookie.claimUserId;
        const claimSub = stateCookie.claimSub;
        if (!claimUserId || !claimSub || claimSub !== linuxdoUser.sub || claimUserId !== user.id) {
          throw ctx.redirect(resultUrl(origin, stateCookie.returnTo, { claim: 'missing_linuxdo' }).toString());
        }
        const plan = resolveLinuxDoMembership(linuxdoUser);
        if (!plan) {
          throw ctx.redirect(resultUrl(origin, stateCookie.returnTo, { claim: 'no_eligibility' }).toString());
        }

        let result: ClaimResult = null;
        let claimError = false;
        try {
          result = await systemDb().rpc('claim_linuxdo_membership_as_service', {
            p_user_id: claimUserId,
            p_plan_id: plan,
            p_trust_level: linuxdoUser.trust_level ?? 0,
            p_provider_user_id: linuxdoUser.sub,
          }) as ClaimResult;
        } catch (error) {
          console.error('[linuxdo] membership claim failed:', error);
          claimError = true;
        }

        const claim = claimError
          ? 'claim_failed'
          : result?.status === 'ok'
            ? 'ok'
            : result?.status === 'cooldown'
              ? 'cooldown'
              : result?.status === 'lower_tier_ignored'
                ? 'lower_tier_ignored'
                : result?.status === 'user_not_found'
                  ? 'missing_linuxdo'
                  : 'claim_failed';
        throw ctx.redirect(resultUrl(origin, stateCookie.returnTo, {
          claim,
          next_available_at: claim === 'cooldown' ? result?.next_available_at ?? null : null,
        }).toString());
      }),
    },
  };
}
