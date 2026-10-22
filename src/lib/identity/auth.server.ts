import 'server-only';

import { betterAuth } from 'better-auth';
import { createAuthMiddleware, APIError, isAPIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins';
import { createAuthPool } from '@/lib/db/pool.server';
import { renderOtpEmail } from '@/lib/email/templates';
import { enqueueEmail } from '@/lib/email/queue.server';
import {
  clearLoginFailures,
  isLoginLocked,
  recordLoginFailure,
} from '@/lib/identity/login-guard.server';
import { hashPassword, verifyPassword } from '@/lib/identity/password';
import { authSecondaryStorage } from '@/lib/identity/secondary-storage.server';
import { linuxdoPlugin } from '@/lib/identity/linuxdo-plugin.server';
import { parseConfiguredOrigin, shouldSecureAuthCookies } from '@/lib/runtime-env';

const SIGN_IN_PATH = '/sign-in/email';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} configuration`);
  return value;
}

function appOrigin(): string {
  return parseConfiguredOrigin(process.env.APP_ORIGIN, 'APP_ORIGIN').origin;
}

function bodyEmail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const email = (body as { email?: unknown }).email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

function buildAuth() {
  const secret = requireEnv('BETTER_AUTH_SECRET');
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  const origin = appOrigin();
  return betterAuth({
    appName: '命理排盘',
    baseURL: origin,
    basePath: '/api/auth',
    secret,
    trustedOrigins: [origin],
    database: createAuthPool(),
    secondaryStorage: authSecondaryStorage,
    user: {
      modelName: 'users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      storeSessionInDatabase: true,
      // Cookie caching would keep a signed session valid until its maxAge even
      // after a password reset revokes the database row. Read the database on
      // every session lookup instead; the pool is small and sessions are hot.
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 72,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
    },
    rateLimit: {
      enabled: true,
      storage: 'secondary-storage',
      window: 60,
      max: 100,
      customRules: {
        [SIGN_IN_PATH]: { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: 'taibu',
      useSecureCookies: shouldSecureAuthCookies(),
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = bodyEmail(ctx.body);
        if (!email) return;
        if (await isLoginLocked(email)) {
          throw APIError.fromStatus(429, { message: '登录失败次数过多，请15分钟后再试' });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = bodyEmail(ctx.body);
        if (!email) return;
        const returned = ctx.context.returned;
        if (isAPIError(returned)) {
          // A 429 from the guard above is not another failed credential attempt.
          if (returned.statusCode !== 429) await recordLoginFailure(email);
          return;
        }
        await clearLoginFailures(email);
      }),
    },
    plugins: [
      linuxdoPlugin(),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        disableSignUp: true,
        overrideDefaultEmailVerification: true,
        async sendVerificationOTP({ email, otp, type }) {
          const template = renderOtpEmail({ otp, type });
          await enqueueEmail({ to: email, ...template });
        },
      }),
      nextCookies(),
    ],
  });
}

export type AppAuth = ReturnType<typeof buildAuth>;

let auth: AppAuth | null = null;

/** Lazy so builds and unit tests do not need the runtime secrets. */
export function getAuth(): AppAuth {
  auth ??= buildAuth();
  return auth;
}

export async function getAuthSession(headers: Headers) {
  return getAuth().api.getSession({ headers });
}
