import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.LINUXDO_CLIENT_ID = 'linuxdo-client-id';
process.env.LINUXDO_CLIENT_SECRET = 'linuxdo-client-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';

type MockFetchResponse = {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
};

test('fetchUserInfo should retry backup endpoint and normalize legacy Linux.do payload', async (t) => {
  const originalFetch = global.fetch;
  const calls: string[] = [];

  const legacyPayload = {
    sub: 'linuxdo-user-1',
    username: 'alice',
    name: 'Alice',
    email: 'alice@example.com',
    avatar_url: 'https://cdn.example.com/avatar.png',
  };

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url === 'https://connect.linux.do/api/user') {
      return {
        ok: false,
        status: 503,
        text: async () => 'upstream blocked',
      } satisfies MockFetchResponse as Response;
    }

    if (url === 'https://connect.linuxdo.org/api/user') {
      return {
        ok: true,
        status: 200,
        json: async () => legacyPayload,
      } satisfies MockFetchResponse as Response;
    }

    throw new Error(`unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  const { fetchUserInfo } = await import('../lib/oauth/linuxdo');
  const user = await fetchUserInfo('access-token');

  assert.deepEqual(calls, [
    'https://connect.linux.do/api/user',
    'https://connect.linuxdo.org/api/user',
  ]);
  assert.equal(user.preferred_username, 'alice');
  assert.equal(user.picture, 'https://cdn.example.com/avatar.png');
  assert.equal(user.email_verified, undefined);
});

test('exchangeCode should retry backup token endpoint when primary host fails', async (t) => {
  const originalFetch = global.fetch;
  const calls: string[] = [];

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url === 'https://connect.linux.do/oauth2/token') {
      return {
        ok: false,
        status: 502,
        text: async () => 'bad gateway',
      } satisfies MockFetchResponse as Response;
    }

    if (url === 'https://connect.linuxdo.org/oauth2/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'token-from-backup',
          token_type: 'bearer',
          refresh_token: 'refresh-from-backup',
        }),
      } satisfies MockFetchResponse as Response;
    }

    throw new Error(`unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  const { exchangeCode } = await import('../lib/oauth/linuxdo');
  const token = await exchangeCode(
    'oauth-code',
    'code-verifier',
    'https://mingai.fun/api/auth/linuxdo/callback',
  );

  assert.deepEqual(calls, [
    'https://connect.linux.do/oauth2/token',
    'https://connect.linuxdo.org/oauth2/token',
  ]);
  assert.equal(token.access_token, 'token-from-backup');
  assert.equal(token.refresh_token, 'refresh-from-backup');
});

test('linuxdo route should sanitize external returnTo before storing oauth state', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/auth/linuxdo/route');

  const originalGenerateState = linuxdoModule.generateState;
  const originalGeneratePKCE = linuxdoModule.generatePKCE;
  const originalBuildAuthUrl = linuxdoModule.buildAuthUrl;
  const originalGetAuthContext = apiUtilsModule.getAuthContext;

  linuxdoModule.generateState = () => 'oauth-state';
  linuxdoModule.generatePKCE = () => ({
    codeVerifier: 'code-verifier',
    codeChallenge: 'code-challenge',
  });
  linuxdoModule.buildAuthUrl = () => 'https://connect.linux.do/oauth2/authorize?mock=1';
  apiUtilsModule.getAuthContext = async () => ({
    user: {
      id: 'linuxdo-user',
      user_metadata: {
        linuxdo_sub: 'linuxdo-sub-1',
      },
    },
  });

  t.after(() => {
    linuxdoModule.generateState = originalGenerateState;
    linuxdoModule.generatePKCE = originalGeneratePKCE;
    linuxdoModule.buildAuthUrl = originalBuildAuthUrl;
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/auth/linuxdo/route') as typeof import('../app/api/auth/linuxdo/route');
  const response = await routeModule.GET(new NextRequest('http://localhost/api/auth/linuxdo?intent=membership-claim&returnTo=%2F%2Fevil.com%2Fpwn'));

  assert.equal(response.status, 307);
  const oauthStateCookie = response.cookies.get('linuxdo-oauth-state');
  assert.ok(oauthStateCookie?.value);
  const parsed = JSON.parse(oauthStateCookie!.value) as {
    state: string;
    codeVerifier: string;
    intent: string;
    returnTo: string;
  };
  assert.equal(parsed.state, 'oauth-state');
  assert.equal(parsed.codeVerifier, 'code-verifier');
  assert.equal(parsed.intent, 'membership-claim');
  assert.equal(parsed.returnTo, '/');
});

test('linuxdo route should reject monthly claim intent when current session is not a linuxdo user', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/auth/linuxdo/route');

  const originalGenerateState = linuxdoModule.generateState;
  const originalGeneratePKCE = linuxdoModule.generatePKCE;
  const originalBuildAuthUrl = linuxdoModule.buildAuthUrl;
  const originalGetAuthContext = apiUtilsModule.getAuthContext;

  linuxdoModule.generateState = () => 'oauth-state';
  linuxdoModule.generatePKCE = () => ({
    codeVerifier: 'code-verifier',
    codeChallenge: 'code-challenge',
  });
  linuxdoModule.buildAuthUrl = () => 'https://connect.linux.do/oauth2/authorize?mock=1';
  apiUtilsModule.getAuthContext = async () => ({
    user: {
      id: 'normal-user',
      user_metadata: {},
    },
  });

  t.after(() => {
    linuxdoModule.generateState = originalGenerateState;
    linuxdoModule.generatePKCE = originalGeneratePKCE;
    linuxdoModule.buildAuthUrl = originalBuildAuthUrl;
    apiUtilsModule.getAuthContext = originalGetAuthContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/auth/linuxdo/route') as typeof import('../app/api/auth/linuxdo/route');
  const response = await routeModule.GET(new NextRequest('http://localhost/api/auth/linuxdo?intent=membership-claim&returnTo=%2Fbazi%23settings%2Fupgrade'));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/bazi?claim=missing_linuxdo#settings/upgrade');
  assert.equal(response.cookies.get('linuxdo-oauth-state'), undefined);
});

test('linuxdo callback should redirect oauth errors back to sanitized returnTo when state cookie is present', async (t) => {
  const routePath = require.resolve('../app/api/auth/linuxdo/callback/route');

  t.after(() => {
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/auth/linuxdo/callback/route') as typeof import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
    intent: 'membership-claim',
    returnTo: '/bazi#settings/upgrade',
  }));

  const response = await routeModule.GET(new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?error=access_denied',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  ));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/bazi?error=oauth_denied#settings/upgrade');
});

test('linuxdo callback should preserve returnTo when token exchange fails after state validation', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as any;
  const routePath = require.resolve('../app/api/auth/linuxdo/callback/route');

  const originalExchangeCode = linuxdoModule.exchangeCode;

  linuxdoModule.exchangeCode = async () => {
    throw new Error('token exchange failed');
  };

  t.after(() => {
    linuxdoModule.exchangeCode = originalExchangeCode;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const routeModule = require('../app/api/auth/linuxdo/callback/route') as typeof import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
    intent: 'membership-claim',
    returnTo: '/bazi#settings/upgrade',
  }));

  const response = await routeModule.GET(new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?code=oauth-code&state=expected-state',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  ));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/bazi?error=token_exchange_failed#settings/upgrade');
});

test('linuxdo callback should not reject login when email_verified claim is missing', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as {
    exchangeCode: (code: string, verifier: string, redirectUri: string) => Promise<{ access_token: string }>;
    fetchUserInfo: (accessToken: string) => Promise<Record<string, unknown>>;
    generateDeterministicPassword: (sub: string) => string;
  };
  const apiUtilsModule = require('../lib/api-utils') as {
    createAnonClient: () => {
      auth: {
        signUp: (args: unknown) => Promise<{ data: { session: { user: { id: string } } }; error: null }>;
      };
    };
    getAuthAdminClient: () => null;
    getSystemAdminClient: () => {
      from: (table: string) => {
        select?: () => { eq: (field: string, value: string) => { eq?: (field2: string, value2: string) => { maybeSingle: () => Promise<{ data: { user_id: string } | null }> }; maybeSingle?: () => Promise<{ data: { id: string } | null }> } };
        upsert?: () => Promise<{ error: null }>;
        insert?: () => Promise<{ error: null }>;
      };
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: { status: string }; error: null }>;
    };
  };
  const authSessionModule = require('../lib/auth-session') as {
    setSessionCookies: (response: Response, session: unknown) => void;
  };

  const originalExchangeCode = linuxdoModule.exchangeCode;
  const originalFetchUserInfo = linuxdoModule.fetchUserInfo;
  const originalGenerateDeterministicPassword = linuxdoModule.generateDeterministicPassword;
  const originalCreateAnonClient = apiUtilsModule.createAnonClient;
  const originalGetAuthAdminClient = apiUtilsModule.getAuthAdminClient;
  const originalGetServiceRoleClient = apiUtilsModule.getSystemAdminClient;
  const originalSetSessionCookies = authSessionModule.setSessionCookies;

  linuxdoModule.exchangeCode = async () => ({ access_token: 'access-token' });
  linuxdoModule.fetchUserInfo = async () => ({
    sub: 'linuxdo-user-1',
    preferred_username: 'alice',
    name: 'Alice',
    email: 'alice@example.com',
    picture: 'https://cdn.example.com/avatar.png',
  });
  linuxdoModule.generateDeterministicPassword = () => 'deterministic-password';

  apiUtilsModule.createAnonClient = () => ({
    auth: {
      signUp: async () => ({
        data: {
          session: {
            user: { id: 'user-1' },
          },
        },
        error: null,
      }),
    },
  });
  apiUtilsModule.getAuthAdminClient = () => null;

  apiUtilsModule.getSystemAdminClient = () => ({
    from: (table: string) => {
      if (table === 'user_oauth_providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null }),
              }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    rpc: async () => ({
      data: { status: 'ok' },
      error: null,
    }),
  });

  authSessionModule.setSessionCookies = () => {};

  t.after(() => {
    linuxdoModule.exchangeCode = originalExchangeCode;
    linuxdoModule.fetchUserInfo = originalFetchUserInfo;
    linuxdoModule.generateDeterministicPassword = originalGenerateDeterministicPassword;
    apiUtilsModule.createAnonClient = originalCreateAnonClient;
    apiUtilsModule.getAuthAdminClient = originalGetAuthAdminClient;
    apiUtilsModule.getSystemAdminClient = originalGetServiceRoleClient;
    authSessionModule.setSessionCookies = originalSetSessionCookies;
  });

  const { GET } = await import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
  }));
  const request = new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?code=oauth-code&state=expected-state',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  );

  const response = await GET(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/');
});

test('linuxdo callback should create new users through admin api instead of public signup', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as {
    exchangeCode: (code: string, verifier: string, redirectUri: string) => Promise<{ access_token: string }>;
    fetchUserInfo: (accessToken: string) => Promise<Record<string, unknown>>;
    generateDeterministicPassword: (sub: string) => string;
  };
  const apiUtilsModule = require('../lib/api-utils') as {
    createAnonClient: () => {
      auth: {
        signUp: () => Promise<{ data: { session: null }; error: { message: string } }>;
        signInWithPassword: () => Promise<{ data: { session: { user: { id: string } } }; error: null }>;
      };
    };
    getAuthAdminClient: () => {
      auth: {
        admin: {
          createUser: (payload: Record<string, unknown>) => Promise<{ data: { user: { id: string } }; error: null }>;
        };
      };
    };
    getSystemAdminClient: () => {
      from: (table: string) => {
        select?: () => { eq: (field: string, value: string) => { eq?: (field2: string, value2: string) => { maybeSingle: () => Promise<{ data: { user_id: string } | null }> }; maybeSingle?: () => Promise<{ data: { id: string } | null }> } };
        upsert?: () => Promise<{ error: null }>;
        insert?: () => Promise<{ error: null }>;
      };
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: { status: string }; error: null }>;
    };
  };
  const authSessionModule = require('../lib/auth-session') as {
    setSessionCookies: (response: Response, session: unknown) => void;
  };

  const originalExchangeCode = linuxdoModule.exchangeCode;
  const originalFetchUserInfo = linuxdoModule.fetchUserInfo;
  const originalGenerateDeterministicPassword = linuxdoModule.generateDeterministicPassword;
  const originalCreateAnonClient = apiUtilsModule.createAnonClient;
  const originalGetAuthAdminClient = apiUtilsModule.getAuthAdminClient;
  const originalGetServiceRoleClient = apiUtilsModule.getSystemAdminClient;
  const originalSetSessionCookies = authSessionModule.setSessionCookies;

  let publicSignUpCalls = 0;
  let adminCreateUserCalls = 0;
  let signInCalls = 0;
  let createUserPayload: Record<string, unknown> | null = null;

  linuxdoModule.exchangeCode = async () => ({ access_token: 'access-token' });
  linuxdoModule.fetchUserInfo = async () => ({
    sub: 'linuxdo-user-2',
    preferred_username: 'bob',
    name: 'Bob',
    email: 'bob@example.com',
    email_verified: true,
    picture: 'https://cdn.example.com/bob.png',
  });
  linuxdoModule.generateDeterministicPassword = () => 'deterministic-password';

  apiUtilsModule.createAnonClient = () => ({
    auth: {
      signUp: async () => {
        publicSignUpCalls += 1;
        return {
          data: { session: null },
          error: { message: 'Email address not authorized' },
        };
      },
      signInWithPassword: async () => {
        signInCalls += 1;
        return {
          data: {
            session: {
              user: { id: 'user-2' },
            },
          },
          error: null,
        };
      },
    },
  });

  apiUtilsModule.getAuthAdminClient = () => ({
    auth: {
      admin: {
        createUser: async (payload: Record<string, unknown>) => {
          adminCreateUserCalls += 1;
          createUserPayload = payload;
          return {
            data: { user: { id: 'user-2' } },
            error: null,
          };
        },
      },
    },
  });

  apiUtilsModule.getSystemAdminClient = () => ({
    from: (table: string) => {
      if (table === 'user_oauth_providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null }),
              }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    rpc: async () => ({
      data: { status: 'ok' },
      error: null,
    }),
  });

  authSessionModule.setSessionCookies = () => {};

  t.after(() => {
    linuxdoModule.exchangeCode = originalExchangeCode;
    linuxdoModule.fetchUserInfo = originalFetchUserInfo;
    linuxdoModule.generateDeterministicPassword = originalGenerateDeterministicPassword;
    apiUtilsModule.createAnonClient = originalCreateAnonClient;
    apiUtilsModule.getAuthAdminClient = originalGetAuthAdminClient;
    apiUtilsModule.getSystemAdminClient = originalGetServiceRoleClient;
    authSessionModule.setSessionCookies = originalSetSessionCookies;
  });

  const { GET } = await import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
  }));
  const request = new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?code=oauth-code&state=expected-state',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  );

  const response = await GET(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/');
  assert.equal(publicSignUpCalls, 0);
  assert.equal(adminCreateUserCalls, 1);
  assert.equal(signInCalls, 1);
  const createdUser = createUserPayload as Record<string, unknown> | null;
  assert.ok(createdUser);
  assert.equal(createdUser.email_confirm, true);
  assert.equal(
    (createdUser.user_metadata as Record<string, unknown>)?.linuxdo_sub,
    'linuxdo-user-2',
  );
  assert.equal(
    ((createdUser.user_metadata as Record<string, unknown>)?.linuxdo_provider_metadata as Record<string, unknown>)?.sub,
    'linuxdo-user-2',
  );
});

test('linuxdo callback should surface missing auth admin key when public signup is blocked', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as {
    exchangeCode: (code: string, verifier: string, redirectUri: string) => Promise<{ access_token: string }>;
    fetchUserInfo: (accessToken: string) => Promise<Record<string, unknown>>;
    generateDeterministicPassword: (sub: string) => string;
  };
  const apiUtilsModule = require('../lib/api-utils') as {
    createAnonClient: () => {
      auth: {
        signUp: () => Promise<{ data: { session: null }; error: { message: string } }>;
      };
    };
    getAuthAdminClient: () => null;
    getSystemAdminClient: () => {
      from: (table: string) => {
        select?: () => { eq: (field: string, value: string) => { eq?: (field2: string, value2: string) => { maybeSingle: () => Promise<{ data: { user_id: string } | null }> } } };
      };
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: { status: string } | null; error: null }>;
    };
  };

  const originalExchangeCode = linuxdoModule.exchangeCode;
  const originalFetchUserInfo = linuxdoModule.fetchUserInfo;
  const originalGenerateDeterministicPassword = linuxdoModule.generateDeterministicPassword;
  const originalCreateAnonClient = apiUtilsModule.createAnonClient;
  const originalGetAuthAdminClient = apiUtilsModule.getAuthAdminClient;
  const originalGetServiceRoleClient = apiUtilsModule.getSystemAdminClient;

  linuxdoModule.exchangeCode = async () => ({ access_token: 'access-token' });
  linuxdoModule.fetchUserInfo = async () => ({
    sub: 'linuxdo-user-3',
    preferred_username: 'carol',
    name: 'Carol',
    email: 'carol@example.com',
    email_verified: true,
  });
  linuxdoModule.generateDeterministicPassword = () => 'deterministic-password';

  apiUtilsModule.createAnonClient = () => ({
    auth: {
      signUp: async () => ({
        data: { session: null },
        error: { message: 'Email address not authorized' },
      }),
    },
  });
  apiUtilsModule.getAuthAdminClient = () => null;
  apiUtilsModule.getSystemAdminClient = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
    }),
    rpc: async () => ({
      data: { status: 'ok' },
      error: null,
    }),
  });

  t.after(() => {
    linuxdoModule.exchangeCode = originalExchangeCode;
    linuxdoModule.fetchUserInfo = originalFetchUserInfo;
    linuxdoModule.generateDeterministicPassword = originalGenerateDeterministicPassword;
    apiUtilsModule.createAnonClient = originalCreateAnonClient;
    apiUtilsModule.getAuthAdminClient = originalGetAuthAdminClient;
    apiUtilsModule.getSystemAdminClient = originalGetServiceRoleClient;
  });

  const { GET } = await import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
  }));
  const request = new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?code=oauth-code&state=expected-state',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  );

  const response = await GET(request);

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get('location'),
    'http://localhost/?error=signup_requires_admin_key',
  );
});

test('linuxdo callback should recover existing deterministic linuxdo account when provider binding is missing', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as {
    exchangeCode: (code: string, verifier: string, redirectUri: string) => Promise<{ access_token: string }>;
    fetchUserInfo: (accessToken: string) => Promise<Record<string, unknown>>;
    generateDeterministicPassword: (sub: string) => string;
  };
  const apiUtilsModule = require('../lib/api-utils') as {
    createAnonClient: () => {
      auth: {
        signInWithPassword: () => Promise<{ data: { session: { user: { id: string } } }; error: null }>;
      };
    };
    getAuthAdminClient: () => {
      auth: {
        admin: {
          listUsers: () => Promise<{ data: { users: Array<{ id: string; email: string; user_metadata: Record<string, unknown> }> }; error: null }>;
          updateUserById: (
            id: string,
            payload: Record<string, unknown>,
          ) => Promise<{ data: { user: { id: string; email: string } }; error: null }>;
          createUser: () => Promise<{ data: { user: null }; error: { message: string } }>;
        };
      };
    };
    getSystemAdminClient: () => {
      from: (table: string) => Record<string, unknown>;
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: { status: string }; error: null }>;
    };
  };
  const authSessionModule = require('../lib/auth-session') as {
    setSessionCookies: (response: Response, session: unknown) => void;
  };

  const originalExchangeCode = linuxdoModule.exchangeCode;
  const originalFetchUserInfo = linuxdoModule.fetchUserInfo;
  const originalGenerateDeterministicPassword = linuxdoModule.generateDeterministicPassword;
  const originalCreateAnonClient = apiUtilsModule.createAnonClient;
  const originalGetAuthAdminClient = apiUtilsModule.getAuthAdminClient;
  const originalGetServiceRoleClient = apiUtilsModule.getSystemAdminClient;
  const originalSetSessionCookies = authSessionModule.setSessionCookies;

  let signInCalls = 0;

  linuxdoModule.exchangeCode = async () => ({ access_token: 'access-token' });
  linuxdoModule.fetchUserInfo = async () => ({
    sub: 'linuxdo-user-4',
    preferred_username: 'dylan',
    name: 'Dylan',
    email: 'dylan@example.com',
    email_verified: true,
    picture: 'https://cdn.example.com/dylan.png',
  });
  linuxdoModule.generateDeterministicPassword = () => 'deterministic-password';

  apiUtilsModule.createAnonClient = () => ({
    auth: {
      signInWithPassword: async () => {
        signInCalls += 1;
        return {
          data: {
            session: {
              user: { id: 'user-4' },
            },
          },
          error: null,
        };
      },
    },
  });

  apiUtilsModule.getAuthAdminClient = () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: null },
          error: { message: 'not found' },
        }),
        listUsers: async () => ({
          data: {
            users: [
              {
                id: 'user-4',
                email: 'dylan@example.com',
                user_metadata: {
                  linuxdo_sub: 'linuxdo-user-4',
                },
              },
            ],
          },
          error: null,
        }),
        updateUserById: async () => ({
          data: {
            user: {
              id: 'user-4',
              email: 'dylan@example.com',
            },
          },
          error: null,
        }),
        createUser: async () => ({
          data: { user: null },
          error: { message: 'User already registered' },
        }),
      },
    },
  });

  apiUtilsModule.getSystemAdminClient = () => ({
    from: (table: string) => {
      if (table === 'user_oauth_providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    rpc: async () => ({
      data: { status: 'ok' },
      error: null,
    }),
  });

  authSessionModule.setSessionCookies = () => {};

  t.after(() => {
    linuxdoModule.exchangeCode = originalExchangeCode;
    linuxdoModule.fetchUserInfo = originalFetchUserInfo;
    linuxdoModule.generateDeterministicPassword = originalGenerateDeterministicPassword;
    apiUtilsModule.createAnonClient = originalCreateAnonClient;
    apiUtilsModule.getAuthAdminClient = originalGetAuthAdminClient;
    apiUtilsModule.getSystemAdminClient = originalGetServiceRoleClient;
    authSessionModule.setSessionCookies = originalSetSessionCookies;
  });

  const { GET } = await import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
  }));
  const request = new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?code=oauth-code&state=expected-state',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  );

  const response = await GET(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/');
  assert.equal(signInCalls, 1);
});

test('linuxdo callback should surface signup failure when auth user creation is rejected', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as {
    exchangeCode: (code: string, verifier: string, redirectUri: string) => Promise<{ access_token: string }>;
    fetchUserInfo: (accessToken: string) => Promise<Record<string, unknown>>;
    generateDeterministicPassword: (sub: string) => string;
  };
  const apiUtilsModule = require('../lib/api-utils') as {
    createAnonClient: () => {
      auth: {
        signInWithPassword: () => Promise<{ data: { session: { user: { id: string } } }; error: null }>;
      };
    };
    getAuthAdminClient: () => {
      auth: {
        admin: {
          createUser: () => Promise<{ data: { user: null }; error: { message: string } }>;
        };
      };
    };
    getSystemAdminClient: () => {
      from: (table: string) => Record<string, unknown>;
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: null; error: { message: string } }>;
    };
  };
  const authSessionModule = require('../lib/auth-session') as {
    setSessionCookies: (response: Response, session: unknown) => void;
  };

  const originalExchangeCode = linuxdoModule.exchangeCode;
  const originalFetchUserInfo = linuxdoModule.fetchUserInfo;
  const originalGenerateDeterministicPassword = linuxdoModule.generateDeterministicPassword;
  const originalCreateAnonClient = apiUtilsModule.createAnonClient;
  const originalGetAuthAdminClient = apiUtilsModule.getAuthAdminClient;
  const originalGetServiceRoleClient = apiUtilsModule.getSystemAdminClient;
  const originalSetSessionCookies = authSessionModule.setSessionCookies;

  linuxdoModule.exchangeCode = async () => ({ access_token: 'access-token' });
  linuxdoModule.fetchUserInfo = async () => ({
    sub: 'linuxdo-user-5',
    preferred_username: 'eve',
    name: 'Eve',
    email: 'eve@example.com',
    email_verified: true,
  });
  linuxdoModule.generateDeterministicPassword = () => 'deterministic-password';

  apiUtilsModule.createAnonClient = () => ({
    auth: {
      signInWithPassword: async () => ({
        data: {
          session: {
            user: { id: 'user-5' },
          },
        },
        error: null,
      }),
    },
  });

  apiUtilsModule.getAuthAdminClient = () => ({
    auth: {
      admin: {
        createUser: async () => ({
          data: { user: null },
          error: { message: 'Database error saving new user' },
        }),
      },
    },
  });

  apiUtilsModule.getSystemAdminClient = () => ({
    from: (table: string) => {
      if (table === 'user_oauth_providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    rpc: async () => ({
      data: null,
      error: { message: 'new row violates row-level security policy' },
    }),
  });

  authSessionModule.setSessionCookies = () => {};

  t.after(() => {
    linuxdoModule.exchangeCode = originalExchangeCode;
    linuxdoModule.fetchUserInfo = originalFetchUserInfo;
    linuxdoModule.generateDeterministicPassword = originalGenerateDeterministicPassword;
    apiUtilsModule.createAnonClient = originalCreateAnonClient;
    apiUtilsModule.getAuthAdminClient = originalGetAuthAdminClient;
    apiUtilsModule.getSystemAdminClient = originalGetServiceRoleClient;
    authSessionModule.setSessionCookies = originalSetSessionCookies;
  });

  const { GET } = await import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
  }));
  const request = new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?code=oauth-code&state=expected-state',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  );

  const response = await GET(request);

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get('location'),
    'http://localhost/?error=signup_failed',
  );
});

test('linuxdo callback should claim monthly membership and redirect back to membership center', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;
  const authSessionModule = require('../lib/auth-session') as any;

  const originalExchangeCode = linuxdoModule.exchangeCode;
  const originalFetchUserInfo = linuxdoModule.fetchUserInfo;
  const originalGenerateDeterministicPassword = linuxdoModule.generateDeterministicPassword;
  const originalCreateAnonClient = apiUtilsModule.createAnonClient;
  const originalGetAuthAdminClient = apiUtilsModule.getAuthAdminClient;
  const originalGetServiceRoleClient = apiUtilsModule.getSystemAdminClient;
  const originalSetSessionCookies = authSessionModule.setSessionCookies;

  const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };

  linuxdoModule.exchangeCode = async () => ({ access_token: 'access-token' });
  linuxdoModule.fetchUserInfo = async () => ({
    sub: 'linuxdo-user-claim',
    preferred_username: 'claim-user',
    name: 'Claim User',
    email: 'claim@example.com',
    email_verified: true,
    trust_level: 2,
  });
  linuxdoModule.generateDeterministicPassword = () => 'deterministic-password';

  apiUtilsModule.createAnonClient = () => ({
    auth: {
      signInWithPassword: async () => ({
        data: {
          session: {
            user: { id: 'user-claim' },
          },
        },
        error: null,
      }),
    },
  });

  apiUtilsModule.getAuthAdminClient = () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              id: 'user-claim',
              email: 'claim@example.com',
              user_metadata: {},
            },
          },
          error: null,
        }),
        updateUserById: async () => ({
          data: {
            user: {
              id: 'user-claim',
              email: 'claim@example.com',
              user_metadata: {},
            },
          },
          error: null,
        }),
      },
    },
  });

  apiUtilsModule.getSystemAdminClient = () => ({
    from: (table: string) => {
      if (table === 'user_oauth_providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { user_id: 'user-claim' }, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'user-claim' }, error: null }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      capture.rpcCall = { fn, args };
      return {
        data: { status: 'ok' },
        error: null,
      };
    },
  });

  authSessionModule.setSessionCookies = () => {};

  t.after(() => {
    linuxdoModule.exchangeCode = originalExchangeCode;
    linuxdoModule.fetchUserInfo = originalFetchUserInfo;
    linuxdoModule.generateDeterministicPassword = originalGenerateDeterministicPassword;
    apiUtilsModule.createAnonClient = originalCreateAnonClient;
    apiUtilsModule.getAuthAdminClient = originalGetAuthAdminClient;
    apiUtilsModule.getSystemAdminClient = originalGetServiceRoleClient;
    authSessionModule.setSessionCookies = originalSetSessionCookies;
  });

  const { GET } = await import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
    intent: 'membership-claim',
    returnTo: '/bazi#settings/upgrade',
  }));
  const request = new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?code=oauth-code&state=expected-state',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  );

  const response = await GET(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/bazi?claim=ok#settings/upgrade');
  assert.equal(capture.rpcCall?.fn, 'claim_linuxdo_membership_as_service');
  assert.deepEqual(capture.rpcCall?.args, {
    p_user_id: 'user-claim',
    p_plan_id: 'plus',
    p_trust_level: 2,
    p_provider_user_id: 'linuxdo-user-claim',
  });
});

test('linuxdo callback should short-circuit monthly claim when trust level is insufficient', async (t) => {
  const linuxdoModule = require('../lib/oauth/linuxdo') as any;
  const apiUtilsModule = require('../lib/api-utils') as any;
  const authSessionModule = require('../lib/auth-session') as any;

  const originalExchangeCode = linuxdoModule.exchangeCode;
  const originalFetchUserInfo = linuxdoModule.fetchUserInfo;
  const originalGenerateDeterministicPassword = linuxdoModule.generateDeterministicPassword;
  const originalCreateAnonClient = apiUtilsModule.createAnonClient;
  const originalGetAuthAdminClient = apiUtilsModule.getAuthAdminClient;
  const originalGetServiceRoleClient = apiUtilsModule.getSystemAdminClient;
  const originalSetSessionCookies = authSessionModule.setSessionCookies;

  let rpcCalls = 0;

  linuxdoModule.exchangeCode = async () => ({ access_token: 'access-token' });
  linuxdoModule.fetchUserInfo = async () => ({
    sub: 'linuxdo-user-free',
    preferred_username: 'free-user',
    name: 'Free User',
    email: 'free@example.com',
    email_verified: true,
    trust_level: 1,
  });
  linuxdoModule.generateDeterministicPassword = () => 'deterministic-password';

  apiUtilsModule.createAnonClient = () => ({
    auth: {
      signInWithPassword: async () => ({
        data: {
          session: {
            user: { id: 'user-free' },
          },
        },
        error: null,
      }),
    },
  });

  apiUtilsModule.getAuthAdminClient = () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              id: 'user-free',
              email: 'free@example.com',
              user_metadata: {},
            },
          },
          error: null,
        }),
        updateUserById: async () => ({
          data: {
            user: {
              id: 'user-free',
              email: 'free@example.com',
              user_metadata: {},
            },
          },
          error: null,
        }),
      },
    },
  });

  apiUtilsModule.getSystemAdminClient = () => ({
    from: (table: string) => {
      if (table === 'user_oauth_providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { user_id: 'user-free' }, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'user-free' }, error: null }),
            }),
          }),
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    rpc: async () => {
      rpcCalls += 1;
      return {
        data: { status: 'ok' },
        error: null,
      };
    },
  });

  authSessionModule.setSessionCookies = () => {};

  t.after(() => {
    linuxdoModule.exchangeCode = originalExchangeCode;
    linuxdoModule.fetchUserInfo = originalFetchUserInfo;
    linuxdoModule.generateDeterministicPassword = originalGenerateDeterministicPassword;
    apiUtilsModule.createAnonClient = originalCreateAnonClient;
    apiUtilsModule.getAuthAdminClient = originalGetAuthAdminClient;
    apiUtilsModule.getSystemAdminClient = originalGetServiceRoleClient;
    authSessionModule.setSessionCookies = originalSetSessionCookies;
  });

  const { GET } = await import('../app/api/auth/linuxdo/callback/route');
  const stateValue = encodeURIComponent(JSON.stringify({
    state: 'expected-state',
    codeVerifier: 'code-verifier',
    intent: 'membership-claim',
    returnTo: '/bazi#settings/upgrade',
  }));
  const request = new NextRequest(
    'http://localhost/api/auth/linuxdo/callback?code=oauth-code&state=expected-state',
    {
      headers: {
        cookie: `linuxdo-oauth-state=${stateValue}`,
      },
    },
  );

  const response = await GET(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'http://localhost/bazi?claim=no_eligibility#settings/upgrade');
  assert.equal(rpcCalls, 0);
});
