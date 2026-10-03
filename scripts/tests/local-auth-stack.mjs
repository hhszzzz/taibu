import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { buildPostgresFixture } from './postgres-fixture.mjs';

// Real Auth + PostgREST + PostgreSQL/pgvector; deliberately no Studio, Storage,
// Realtime, TLS, mail delivery or production schema/parity claim. The host proxy
// ONLY forwards HTTP paths. Identity/JWT validation belongs to GoTrue/PostgREST.
// Official configuration references (checked 2026-10-02):
// https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml
// https://github.com/supabase/auth/blob/master/README.md
// https://docs.postgrest.org/en/stable/references/configuration.html
export const AUTH_STACK_IMAGES = {
  db: 'pgvector/pgvector:0.8.6-pg16',
  auth: 'supabase/gotrue:v2.196.0',
  rest: 'postgrest/postgrest:v14.17',
  gateway: 'node:24.13.0-alpine3.23',
};
// Runs in the gateway container. All targets are constants, not request input;
// neither tokens nor bodies are inspected or logged. Backend containers have no
// external network attachment. Only this HTTP forwarder publishes a loopback port.
const gatewayProgram = `
const http = require('node:http');
http.createServer((request, response) => {
  const prefix = request.url?.startsWith('/auth/v1/') ? '/auth/v1'
    : request.url?.startsWith('/rest/v1/') ? '/rest/v1' : null;
  if (!prefix) { response.writeHead(404).end(); return; }
  const hostname = prefix === '/auth/v1' ? 'auth' : 'rest';
  const port = hostname === 'auth' ? 9999 : 3000;
  const forwarded = http.request({ hostname, port, method: request.method,
    path: request.url.slice(prefix.length), headers: { ...request.headers, host: hostname + ':' + port },
  }, incoming => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.pipe(response);
  });
  forwarded.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.on('aborted', () => forwarded.destroy());
  request.pipe(forwarded);
}).listen(8000, '0.0.0.0');
`;
export const AUTH_STACK_LABEL = 'io.taibu.auth-acceptance.run';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const ephemeralSecrets = new Set();
const redact = text => {
  let safe = text;
  for (const secret of ephemeralSecrets) safe = safe.replaceAll(secret, '[redacted]');
  return safe.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted JWT]');
};

function docker(args, { input = '', env = process.env, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { env, timeout, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Never include argv/env/input or complete container inspect. Redact all
      // ephemeral stack secrets before surfacing bounded diagnostic text.
      if (error) reject(new Error(`Local docker ${args[0]} failed (${error.code ?? 'unknown'}): ${redact(stderr).slice(0, 1200)}`));
      else resolve(stdout.trim());
    });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(input);
  });
}

export async function assertLocalDocker() {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
    ? process.env.DOCKER_HOST
    : await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  assert.ok(endpoint.startsWith('unix://'), 'Only a local Unix-socket Docker endpoint is allowed');
  await docker(['version', '--format', '{{.Server.Version}}']);
}

export async function startLocalAuthStack(t, repoRoot) {
  const fixture = await buildPostgresFixture(repoRoot, { authMode: 'gotrue' });
  await assertLocalDocker();
  const runId = randomUUID();
  const network = `taibu-auth-${runId}`;
  const httpNetwork = `${network}-http`;
  const names = Object.fromEntries(Object.keys(AUTH_STACK_IMAGES).map(key => [key, `${network}-${key}`]));
  const password = randomBytes(32).toString('hex');
  const jwtSecret = randomBytes(48).toString('hex');
  ephemeralSecrets.add(password);
  ephemeralSecrets.add(jwtSecret);
  const sign = claims => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${header}.${payload}.${createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const anonKey = sign({ role: 'anon', iss: 'supabase', iat: now, exp: now + 3600 });
  const serviceKey = sign({ role: 'service_role', iss: 'supabase', iat: now, exp: now + 3600 });
  let stopping = false;
  let cleanupPromise;
  const pending = new Set();
  const track = promise => {
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  const labelFilter = ['--filter', `label=${AUTH_STACK_LABEL}=${runId}`];
  const cleanup = () => {
    stopping = true;
    cleanupPromise ??= (async () => {
      // Wait for an in-flight create/start before inspecting ownership, including
      // signals during an image download. Do not race and leave a later orphan.
      await Promise.allSettled([...pending]);
      const owned = (await docker(['ps', '-aq', ...labelFilter])).split('\n').filter(Boolean);
      for (const id of owned) {
        assert.equal(await docker(['inspect', '--format', `{{ index .Config.Labels "${AUTH_STACK_LABEL}" }}`, id]), runId);
        await docker(['rm', '--force', '--volumes', id]);
      }
      const networks = (await docker(['network', 'ls', '-q', ...labelFilter])).split('\n').filter(Boolean);
      for (const id of networks) {
        assert.equal(await docker(['network', 'inspect', '--format', `{{ index .Labels "${AUTH_STACK_LABEL}" }}`, id]), runId);
        await docker(['network', 'rm', id]);
      }
      assert.equal(await docker(['ps', '-aq', ...labelFilter]), '', 'Owned containers leaked');
      assert.equal(await docker(['network', 'ls', '-q', ...labelFilter]), '', 'Owned network leaked');
      assert.equal(await docker(['volume', 'ls', '-q', ...labelFilter]), '', 'Owned volume leaked');
      t.diagnostic(`cleanup ${runId}: containers=0 networks=0 volumes=0; no host data mounts`);
    })();
    return cleanupPromise;
  };
  const interrupt = () => { void cleanup().then(() => process.exit(130), () => process.exit(1)); };
  const terminate = () => { void cleanup().then(() => process.exit(143), () => process.exit(1)); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  t.after(async () => {
    try { await cleanup(); }
    finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    }
  });
  const create = async (key, extra, environment = {}) => {
    assert.ok(!stopping, 'Stack is stopping');
    await track(docker([
      'create', '--name', names[key], '--label', `${AUTH_STACK_LABEL}=${runId}`,
      '--network', network, '--network-alias', key, '--log-driver', 'none',
      ...(key === 'gateway' ? ['--network', httpNetwork] : []),
      '--security-opt', 'no-new-privileges',
      ...Object.keys(environment).flatMap(name => ['--env', name]),
      ...extra, AUTH_STACK_IMAGES[key],
      ...(key === 'gateway' ? ['node', '-e', gatewayProgram] : []),
    ], { env: { ...process.env, ...environment }, timeout: 180_000 }));
    assert.ok(!stopping, 'Stack is stopping');
    await track(docker(['start', names[key]]));
  };
  const waitFor = async (check, description) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !stopping) {
      try { if (await check()) return; } catch { /* readiness only */ }
      await delay(300);
    }
    throw new Error(`${description} did not become ready within 60 seconds`);
  };
  const port = async (key, containerPort) => {
    t.diagnostic(`${key} state: ${await docker(['inspect', '--format', '{{.State.Status}} exit={{.State.ExitCode}} bindings={{json .HostConfig.PortBindings}}', names[key]])}`);
    const value = await docker(['port', names[key], `${containerPort}/tcp`]);
    assert.match(value, /^127\.0\.0\.1:\d+$/, 'Container must publish loopback only');
    return `http://${value}`;
  };
  const sql = statement => docker([
    'exec', '-i', names.db, 'psql', '-X', '--quiet', '--tuples-only', '--no-align',
    '--set', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'taibu_acceptance',
  ], { input: statement });

  await track(docker(['network', 'create', '--internal', '--label', `${AUTH_STACK_LABEL}=${runId}`, network]));
  assert.ok(!stopping, 'Stack is stopping');
  await track(docker(['network', 'create', '--label', `${AUTH_STACK_LABEL}=${runId}`, httpNetwork]));
  await create('gateway', ['--publish', '127.0.0.1::8000', '--read-only', '--tmpfs', '/tmp:rw', '--user', 'node']);
  const url = await port('gateway', 8000);
  await create('db', ['--tmpfs', '/var/lib/postgresql/data:rw'], { POSTGRES_PASSWORD: password, POSTGRES_DB: 'taibu_acceptance' });
  await waitFor(async () => {
    await docker(['exec', names.db, 'sh', '-c', 'read -r name < /proc/1/comm; test "$name" = postgres']);
    await docker(['exec', names.db, 'pg_isready', '-U', 'postgres', '-d', 'taibu_acceptance']);
    return true;
  }, 'PostgreSQL');
  await sql(`CREATE ROLE supabase_auth_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quote(password)};
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path TO auth, public;`);
  await create('auth', ['--read-only', '--tmpfs', '/tmp:rw'], {
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: 'http://127.0.0.1',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@db:5432/taibu_acceptance`,
    GOTRUE_SITE_URL: 'http://127.0.0.1', GOTRUE_DISABLE_SIGNUP: 'false',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_SECRET: jwtSecret,
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '1000', GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000',
    GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true', GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '0',
    GOTRUE_LOG_LEVEL: 'error',
  });
  const authUrl = `${url}/auth/v1`;
  await waitFor(async () => (await fetch(`${authUrl}/health`, { signal: AbortSignal.timeout(2000) })).ok, 'GoTrue');
  await sql(fixture);
  await sql(`CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD ${quote(password)};
GRANT anon, authenticated, service_role TO authenticator;`);
  await create('rest', ['--read-only', '--tmpfs', '/tmp:rw'], {
    PGRST_DB_URI: `postgres://authenticator:${password}@db:5432/taibu_acceptance`,
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
    PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: jwtSecret,
    PGRST_LOG_LEVEL: 'crit', PGRST_SERVER_HOST: '0.0.0.0', PGRST_SERVER_PORT: '3000',
  });
  const restUrl = `${url}/rest/v1`;
  await waitFor(async () => (await fetch(`${restUrl}/`, { signal: AbortSignal.timeout(2000) })).ok, 'PostgREST');

  for (const key of Object.keys(names)) {
    const state = JSON.parse(await docker(['inspect', '--format', '{{json .Mounts}}', names[key]]));
    assert.ok(state.every(mount => mount.Type === 'tmpfs'), 'No bind/volume data mounts allowed');
    t.diagnostic(`${key}: ${AUTH_STACK_IMAGES[key]} ${await docker(['inspect', '--format', '{{.Image}}', names[key]])}`);
  }
  assert.equal(await docker(['network', 'inspect', '--format', '{{.Internal}}', network]), 'true');
  t.diagnostic(`real stack ${runId}: isolated internal network; loopback HTTP forwarding only`);
  return { url, authUrl, restUrl, anonKey, serviceKey, sql, sign, cleanup, runId };
}
