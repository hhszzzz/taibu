import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import storageAttributes from './selfhost/storage-attributes.cjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.taibu-local');
const COMPOSE = path.join(ROOT, 'docker-compose.local.yml');
const MIGRATION = 'supabase/migrations/20261003_100000_fix_rate_limit_admission.sql';
const secret = () => randomBytes(32).toString('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const digest = value => createHash('sha256').update(value).digest('hex');
export function validateProject(value) {
  if (typeof value !== 'string' || value !== value.trim() || !/^taibu-[a-z0-9][a-z0-9-]{0,39}$/.test(value)) throw new Error('项目名须以 taibu- 开头，仅限小写字母、数字和连字符');
  return value;
}
export function validatePort(value) {
  if (String(value) !== String(value).trim() || !/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) throw new Error('端口须为 1024–65535');
  return String(Number(value));
}
export function signJWT(role, jwtSecret, now = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role, iss: 'supabase', iat: now, exp: now + 10 * 365 * 86400 })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')}`;
}
export function createConfig(project, port, demo = false) {
  const config = { LOCAL_INSTANCE_ID: secret(), LOCAL_PROJECT: validateProject(project), APP_PORT: validatePort(port), APP_ORIGIN: `http://127.0.0.1:${validatePort(port)}`, DEMO_ENABLED: demo ? 'true' : 'false', ADMIN_EMAIL: 'admin@taibu.local', USER_EMAIL: 'user@taibu.local', USER2_EMAIL: 'user2@taibu.local' };
  for (const key of ['DB_PASSWORD', 'AUTH_DB_PASSWORD', 'REST_DB_PASSWORD', 'STORAGE_DB_PASSWORD', 'VECTOR_DB_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET', 'INTERNAL_API_SECRET', 'CRON_SECRET', 'ADMIN_PASSWORD', 'USER_PASSWORD', 'USER2_PASSWORD', 'DEMO_API_KEY']) config[key] = secret();
  config.ANON_KEY = signJWT('anon', config.JWT_SECRET);
  config.SERVICE_KEY = signJWT('service_role', config.JWT_SECRET);
  config.AGENT_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  config.TAVILY_API_KEY = '';
  return config;
}
export function validateConfig(config) {
  const expected = Object.keys(createConfig('taibu-validation', '3080')).sort();
  const optionalAgentFields = new Set(['AGENT_CREDENTIAL_ENCRYPTION_KEY','TAVILY_API_KEY','AGENT_MCP_SERVERS']);
  if (!config || JSON.stringify(Object.keys(config).filter(key=>!optionalAgentFields.has(key)).sort()) !== JSON.stringify(expected.filter(key=>!optionalAgentFields.has(key)))) throw new Error('本地配置字段无效');
  if (config.AGENT_CREDENTIAL_ENCRYPTION_KEY !== undefined && (Buffer.from(config.AGENT_CREDENTIAL_ENCRYPTION_KEY,'base64').length!==32 || Buffer.from(config.AGENT_CREDENTIAL_ENCRYPTION_KEY,'base64').toString('base64')!==config.AGENT_CREDENTIAL_ENCRYPTION_KEY)) throw new Error('Agent 加密密钥格式无效');
  validateProject(config.LOCAL_PROJECT); validatePort(config.APP_PORT);
  if (config.APP_ORIGIN !== `http://127.0.0.1:${config.APP_PORT}` || !['true', 'false'].includes(config.DEMO_ENABLED)) throw new Error('本地配置地址无效');
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || /[\r\n$`\\]/.test(value)) throw new Error('本地配置值无效');
    if (key.endsWith('_PASSWORD') || ['LOCAL_INSTANCE_ID', 'JWT_SECRET', 'INTERNAL_API_SECRET', 'CRON_SECRET', 'DEMO_API_KEY'].includes(key)) {
      if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('本地密钥格式无效');
    }
  }
  if (config.ADMIN_EMAIL !== 'admin@taibu.local' || config.USER_EMAIL !== 'user@taibu.local' || config.USER2_EMAIL !== 'user2@taibu.local') throw new Error('种子账号配置无效');
  for (const [key, role] of [['ANON_KEY', 'anon'], ['SERVICE_KEY', 'service_role']]) {
    const pieces = config[key].split('.');
    if (pieces.length !== 3 || !/^[A-Za-z0-9_.-]+$/.test(config[key])) throw new Error('本地 JWT 无效');
    const payload = JSON.parse(Buffer.from(pieces[1], 'base64url'));
    if (signJWT(role, config.JWT_SECRET, payload.iat) !== config[key]) throw new Error('本地 JWT 签名无效');
  }
  return config;
}
async function privateDirectory(directory, exclusive = false) {
  if (exclusive) await mkdir(directory, { mode: 0o700 });
  else await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) throw new Error('私有目录所有权或类型不安全');
  await chmod(directory, 0o700);
}
async function privateRead(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new Error('私有文件权限必须为 0600 且属于当前用户');
  return readFile(file);
}
async function saveConfig(directory, config) {
  await writeFile(path.join(directory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(directory, 'compose.env'), Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(directory, 'credentials.json'), JSON.stringify({ warning: '仅限本地测试；不要公开或提交', admin: { email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD }, user: { email: config.USER_EMAIL, password: config.USER_PASSWORD }, user2: { email: config.USER2_EMAIL, password: config.USER2_PASSWORD } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
export async function initialize(project, port, demo = false) {
  const config = createConfig(project, port, demo);
  await privateDirectory(STATE);
  const directory = path.join(STATE, config.LOCAL_PROJECT);
  await privateDirectory(directory, true); // Never silently rotate existing secrets.
  await saveConfig(directory, config);
  return { directory, config };
}
async function load(project) {
  const rootStat = await lstat(STATE);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || (rootStat.mode & 0o077)) throw new Error('私有根目录权限不安全');
  const directory = path.join(STATE, validateProject(project));
  const dirStat = await lstat(directory);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory() || (dirStat.mode & 0o077)) throw new Error('项目目录权限不安全');
  const config = validateConfig(JSON.parse(await privateRead(path.join(directory, 'config.json'))));
  if (config.LOCAL_PROJECT !== project || config.APP_ORIGIN !== `http://127.0.0.1:${validatePort(config.APP_PORT)}`) throw new Error('本地配置不匹配');
  const env = await privateRead(path.join(directory, 'compose.env'));
  if (env.toString() !== Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n') throw new Error('配置文件不一致；禁止单独编辑 compose.env');
  return { directory, config };
}
// No inherited application env or automatic .env discovery. Docker context is only
// consulted to resolve a Unix socket, then explicitly pinned for all later calls.
function hostEnvironment() {
  return Object.fromEntries(['PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
}
function execute(command, args, { input, env = hostEnvironment(), binary = false, timeout = 120_000, phase } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd: ROOT, env, timeout, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 512 * 1024 * 1024 }, (error, stdout) => {
      // Deliberately never surface stderr, argv, SQL, HTTP body or env. Drivers can
      // echo passwords/DSNs; a generic phase/code is safer than a redaction list.
      if (error) reject(new Error(`本地操作失败（${phase ?? (command === 'docker' ? 'Docker' : '校验')}，代码 ${String(error.code ?? 'unknown').replace(/[^\w-]/g, '')}）`));
      else resolve(stdout);
    });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(new Error('本地输入失败')); });
    child.stdin.end(input);
  });
}
export function validateEndpoint(endpoint) {
  if (!/^unix:\/\/\//.test(endpoint) || endpoint.includes('\n')) throw new Error('仅允许本机 Unix socket Docker，拒绝远程上下文');
  return endpoint;
}
export async function localDocker() {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT ? process.env.DOCKER_HOST : (await execute('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).trim();
  validateEndpoint(endpoint);
  const env = hostEnvironment();
  delete env.DOCKER_CONTEXT;
  env.DOCKER_HOST = endpoint;
  await execute('docker', ['version', '--format', '{{.Server.Version}}'], { env });
  return env;
}
function runner(state, env) {
  const prefix = ['compose', '--project-directory', ROOT, '--env-file', path.join(state.directory, 'compose.env'), '-f', COMPOSE, '-p', state.config.LOCAL_PROJECT, ...(state.config.DEMO_ENABLED === 'true' ? ['--profile', 'demo'] : [])];
  // taibu_app never receives a persisted secret: the password is derived from
  // the stack's existing JWT secret so old private configs stay valid.
  const composeEnv = { ...env, APP_DB_PASSWORD: appDbPassword(state.config), SYSTEM_USER_ID: state.systemUserId ?? '' };
  const compose = (args, options = {}) => execute('docker', [...prefix, ...args], { env: composeEnv, ...options });
  const sql = (input, phase = '数据库查询') => compose(['exec', '-T', 'db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'taibu'], { input, phase });
  return { compose, sql, env };
}
async function wait(check, description) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if (await check()) return; } catch { /* bounded readiness, no sensitive diagnostics */ }
    await delay(1000);
  }
  throw new Error(`${description}未在时限内就绪`);
}
async function httpReady(origin, route) {
  const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
  await response.body?.cancel();
  return response.ok;
}
export function validateResourceOwnership(marker, instance, requireAbsent = false) {
  if (requireAbsent) throw new Error('恢复目标已有 Docker 资源，拒绝覆盖');
  if (marker !== instance) throw new Error('Docker 资源缺少当前实例归属标记，拒绝接管');
}
export function containerNameFilter(project) {
  validateProject(project);
  // Match actual service/container names, not a different project's shared prefix.
  return `name=^/${project}-(db|auth|rest|storage|redis|functions|web|worker|gateway|scheduler|demo|maintenance|maintenance-attributes)-([0-9]+|run-[a-z0-9]+)$`;
}
async function assertOwnedVolumes(state, env, requireAbsent = false) {
  const project = state.config.LOCAL_PROJECT;
  const check = async (kind, id) => {
    if (requireAbsent) throw new Error('恢复目标已有 Docker 资源，拒绝覆盖');
    const prefix = kind === 'container' ? [] : [kind];
    const labelPath = kind === 'container' ? '.Config.Labels' : '.Labels';
    const marker = (await execute('docker', [...prefix, 'inspect', '--format', `{{index ${labelPath} "io.taibu.local.instance"}}`, id], { env })).trim();
    validateResourceOwnership(marker, state.config.LOCAL_INSTANCE_ID);
  };
  // Check both project labels and conventional names: unlabeled leftovers are
  // collisions too. Never adopt a namespace merely because its name matches.
  for (const [kind, list, nameFilter] of [
    ['container', ['ps', '-aq'], containerNameFilter(project)],
    ['network', ['network', 'ls', '-q'], `name=^${project}_`],
  ]) {
    const outputs = await Promise.all([nameFilter, `label=com.docker.compose.project=${project}`].map(filter => execute('docker', [...list, '--filter', filter], { env })));
    for (const id of new Set(outputs.flatMap(output => output.trim().split('\n').filter(Boolean)))) await check(kind, id);
  }
  for (const name of ['database', 'storage', 'redis']) {
    const volume = `${project}_${name}`;
    const found = (await execute('docker', ['volume', 'ls', '--format', '{{.Name}}', '--filter', `name=^${volume}$`], { env })).trim();
    if (found) await check('volume', volume);
  }
}

function rolesSQL(config) {
  return `BEGIN;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD ${quote(config.REST_DB_PASSWORD)};
GRANT anon, authenticated, service_role TO authenticator;
CREATE ROLE supabase_auth_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${quote(config.AUTH_DB_PASSWORD)};
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path TO auth, public;
CREATE ROLE supabase_storage_admin LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${quote(config.STORAGE_DB_PASSWORD)};
GRANT anon, authenticated, service_role TO supabase_storage_admin;
CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
ALTER ROLE supabase_storage_admin SET search_path TO storage, public;
CREATE ROLE taibu_vector_owner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${quote(config.VECTOR_DB_PASSWORD)};
ALTER ROLE taibu_vector_owner SET search_path TO public, extensions;
CREATE SCHEMA extensions;
CREATE EXTENSION vector WITH SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
CREATE SCHEMA local_stack;
REVOKE ALL ON SCHEMA local_stack FROM PUBLIC;
CREATE TABLE local_stack.state (id boolean PRIMARY KEY DEFAULT true CHECK(id), instance_id text NOT NULL, fingerprint text, storage_ready boolean NOT NULL DEFAULT false, seeded boolean NOT NULL DEFAULT false);
INSERT INTO local_stack.state(id,instance_id) VALUES(true,${quote(config.LOCAL_INSTANCE_ID)});
COMMIT;`;
}
export function appDbPassword(config) {
  return createHmac('sha256', config.JWT_SECRET).update('taibu_app').digest('hex');
}
/**
 * Least-privilege application login. It owns nothing and inherits nothing, so a
 * query without a transaction-local role fails closed. Kept outside rolesSQL:
 * it carries no schema objects and must reach existing local volumes.
 */
async function ensureAppRole(run, config) {
  await run.sql(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taibu_app') THEN
    CREATE ROLE taibu_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
GRANT anon, authenticated TO taibu_app WITH INHERIT FALSE, SET TRUE;
ALTER ROLE taibu_app PASSWORD ${quote(appDbPassword(config))};
ALTER ROLE taibu_app SET search_path TO public, extensions;
ALTER ROLE taibu_app SET statement_timeout TO '15s';
ALTER ROLE taibu_app SET lock_timeout TO '5s';
ALTER ROLE taibu_app SET idle_in_transaction_session_timeout TO '30s';`, '应用角色初始化');
  await run.sql('GRANT CONNECT ON DATABASE taibu TO taibu_app; GRANT USAGE ON SCHEMA public, extensions TO taibu_app;', '应用角色授权');
}
async function bootstrapRoles(run, config) {
  const exists = (await run.sql("SELECT to_regclass('local_stack.state') IS NOT NULL")).trim();
  if (exists === 't') {
    const instance = (await run.sql('SELECT instance_id FROM local_stack.state')).trim();
    if (instance !== config.LOCAL_INSTANCE_ID) throw new Error('数据库实例不属于当前私有配置，拒绝接管');
    return;
  }
  const populated = (await run.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v','m','S')")).trim();
  if (populated !== '0') throw new Error('数据库非空且缺少本地版本标记，拒绝初始化');
  await run.sql(rolesSQL(config), '平台角色与扩展初始化');
}
export async function schemaBundle() {
  await execute(process.execPath, ['scripts/selfhost-schema.mjs']);
  const files = ['supabase/selfhost/manifest.json', 'supabase/selfhost/001-application.sql', MIGRATION, 'supabase/selfhost/002-storage.sql'];
  const contents = await Promise.all(files.map(file => readFile(path.join(ROOT, file), 'utf8')));
  const bootstrapContract = [rolesSQL.toString(), application.toString(), withStorageMigrationPrivilege.toString()];
  // Caller inventory/line numbers are provenance, not a schema change. Hash the
  // actual SQL and bootstrap contract so ordinary code updates reuse this stack.
  const applicationSQL = contents[1].replace(/^COMMENT ON SCHEMA public IS 'taibu-selfhost-v1:[a-f0-9]{64}';\n/m, '');
  return { fingerprint: digest(JSON.stringify([applicationSQL, contents[2], contents[3], bootstrapContract])), application: contents[1], migration: contents[2], storage: contents[3] };
}
// Source inventory changes can move caller lines without changing initialized SQL.
// Only explicitly reviewed old/current pairs may reuse a volume or a v2 backup.
const REVIEWED_SCHEMA_EQUIVALENCES = [{
  previous: 'a9bd00e3c1d19991e5be5158f5fa2a9d313428cc60d42f8bb979f6a27a3c60d7',
  current: 'b077a9df03e4593042bed6497fc0e2dd8d6daf07544d4076d4f4044e5018ae23',
  sqlContract: 'e7f8e929833e0ea137129cfe03afb1d6ba4a49c1293c62c268eff8f244dc12fb',
}];

// Only this reviewed Agent baseline may upgrade in place. Unknown SQL drift
// continues to fail closed; this never replays initialization or resets data.
const EXPERIENCE_MIGRATIONS = [
  ['110000_agent_reading_preferences', '377a05f32be8c9de71ff7e410983c95a2663e1fdd707bad0680526abacc658e2'],
  ['120000_agent_search', '0fffdb9815f41d84cc5a63e31dec2da7cecdd0387771ef03a27594aa4fb193cd'],
  ['130000_agent_input_preferences', '84e29f04f70ec8eb0338baac047960ffa6556fbe3a43c90aec0c67b758e004e1'],
  ['140000_agent_queue', 'adf9092f2fa03d18fdaef52e3cb20134e84e6e5ece35580364a4a295959d40e6'],
  ['150000_agent_notifications', '61a3c68ecf0ac582dc75ac86d1f3142dd030445ab834b67c957d95c91439ed4d'],
  ['160000_agent_attachments', '53d5562f071394cb7fd30d0c91526891a9d9b299848d3d0b6a873882a2d56ca6'],
  ['170000_daily_briefing', '4fa35a28d49e8f74ec770e09832cde23efd55755a118d0bc4b6833c6c88976ba'],
  ['180000_conversation_fork', 'e3bb2317479f95523b6079bf0a5e388802907cb8134771525179132174a9409d'],
  ['190000_agent_backend_access', '26bf8dd2d1e758a1dbc3467c051fb4d8fd03c994c1856314b7c221181397e84d'],
  ['20261008_100000_agent_question_dedupe', 'ed9806aa50e8c009390c39ed4d50ffa654097d40a4162009f5d3c644170d3c17'],
  ['20261008_180000_agent_competence', 'a9fe2732170d32b4c448d492090f81c417e7dd05a0804c979e07b528fc0a6208'],
].map(([name, sha256]) => ({ file: `supabase/migrations/${name.startsWith('2026') ? name : `20261007_${name}`}.sql`, sha256 }));
const PREVIOUS_EXPERIENCE_FINGERPRINT = '6072a25ccaae42b489af7f836ec52d80e806906fa4e722d1a343577502afe3be';
const EXPERIENCE_FINGERPRINT = 'c49d95371d32c4da037a0ab2c5ca82bf188be438787baada29a484c1f45fa658';
const PI_DURABLE_MIGRATIONS = [
  ['20261009_100000_agent_pi_durable_1_1', 'bcd3996445aff8a3f610b6e38078f9df94999030b814fcb71f4e23f540e4a687'],
].map(([name, sha256]) => ({ file: `supabase/migrations/${name}.sql`, sha256 }));
const PI_DURABLE_FINGERPRINT = '223d3ed92db07a499114b15eb8be07f258a1e54effc47ee0a1bb812ec7403824';
const REVIEWED_PRE_REASONING_SCHEMA_UPGRADES = [{
  previous: '9a6fd07d2d17f61ee6669d20d4910f2b3b7c621d3d07d9ceeba2b0af26df90be',
  current: 'e639cd6d5a7d70ed5450bd5ee5cc7cd44f3a0924b5b91ce33d719df2c99cec9f',
  file: 'supabase/migrations/20261007_100000_agent_chat_results.sql',
  sha256: '462a8badd3f41fa1f5f5b389f2e2fa4320bc7911d0e125da6d06a8dee27effe8',
}, {
  previous: 'e639cd6d5a7d70ed5450bd5ee5cc7cd44f3a0924b5b91ce33d719df2c99cec9f',
  current: EXPERIENCE_FINGERPRINT,
  files: EXPERIENCE_MIGRATIONS,
}, {
  previous: '9a6fd07d2d17f61ee6669d20d4910f2b3b7c621d3d07d9ceeba2b0af26df90be',
  current: EXPERIENCE_FINGERPRINT,
  files: [{ file: 'supabase/migrations/20261007_100000_agent_chat_results.sql', sha256: '462a8badd3f41fa1f5f5b389f2e2fa4320bc7911d0e125da6d06a8dee27effe8' }, ...EXPERIENCE_MIGRATIONS],
}, {
  previous: PREVIOUS_EXPERIENCE_FINGERPRINT,
  current: EXPERIENCE_FINGERPRINT,
  files: EXPERIENCE_MIGRATIONS.slice(-2),
}, {
  previous: 'aa23300ca84196b4c6e3a5ab0669168420c78be450c4ea8f5cc273ccc3687fc2',
  current: EXPERIENCE_FINGERPRINT,
  files: EXPERIENCE_MIGRATIONS.slice(-3),
}, {
  previous: 'abacc80319e797bcbe1a0bb40434f301d48c93492f2e3cd81dcc60bfb8c19f9b',
  current: EXPERIENCE_FINGERPRINT,
  files: EXPERIENCE_MIGRATIONS.slice(-1),
}, {
  previous: '9a6fd07d2d17f61ee6669d20d4910f2b3b7c621d3d07d9ceeba2b0af26df90be',
  current: PI_DURABLE_FINGERPRINT,
  files: [{ file: 'supabase/migrations/20261007_100000_agent_chat_results.sql', sha256: '462a8badd3f41fa1f5f5b389f2e2fa4320bc7911d0e125da6d06a8dee27effe8' }, ...EXPERIENCE_MIGRATIONS, ...PI_DURABLE_MIGRATIONS],
}, {
  previous: 'e639cd6d5a7d70ed5450bd5ee5cc7cd44f3a0924b5b91ce33d719df2c99cec9f',
  current: PI_DURABLE_FINGERPRINT,
  files: [...EXPERIENCE_MIGRATIONS, ...PI_DURABLE_MIGRATIONS],
}, {
  previous: EXPERIENCE_FINGERPRINT,
  current: PI_DURABLE_FINGERPRINT,
  files: PI_DURABLE_MIGRATIONS,
}, {
  previous: PREVIOUS_EXPERIENCE_FINGERPRINT,
  current: PI_DURABLE_FINGERPRINT,
  files: [...EXPERIENCE_MIGRATIONS.slice(-2), ...PI_DURABLE_MIGRATIONS],
}, {
  previous: 'aa23300ca84196b4c6e3a5ab0669168420c78be450c4ea8f5cc273ccc3687fc2',
  current: PI_DURABLE_FINGERPRINT,
  files: [...EXPERIENCE_MIGRATIONS.slice(-3), ...PI_DURABLE_MIGRATIONS],
}, {
  previous: 'abacc80319e797bcbe1a0bb40434f301d48c93492f2e3cd81dcc60bfb8c19f9b',
  current: PI_DURABLE_FINGERPRINT,
  files: [...EXPERIENCE_MIGRATIONS.slice(-1), ...PI_DURABLE_MIGRATIONS],
}];
const REASONING_EFFORT_FINGERPRINT = '29359295c5ffdf9c652bc33d766fbcb4a0456d712ed982fdc19b274a5d2ee8b6';
const REASONING_EFFORT_MIGRATIONS = [{
  file: 'supabase/migrations/20261009_120000_ai_reasoning_effort_levels.sql',
  sha256: 'b20e45bcea4a96d43476c3656a1220d2bfd104d860eb935835928bd92bd42673',
}];
const REVIEWED_PRE_CURRENT_ENGINE_SCHEMA_UPGRADES = [
  ...REVIEWED_PRE_REASONING_SCHEMA_UPGRADES,
  ...REVIEWED_PRE_REASONING_SCHEMA_UPGRADES.filter(entry => entry.current === PI_DURABLE_FINGERPRINT).map(entry => ({
    previous: entry.previous, current: REASONING_EFFORT_FINGERPRINT,
    files: [...entry.files, ...REASONING_EFFORT_MIGRATIONS],
  })),
  { previous: PI_DURABLE_FINGERPRINT, current: REASONING_EFFORT_FINGERPRINT, files: REASONING_EFFORT_MIGRATIONS },
];
const CURRENT_ENGINE_FINGERPRINT = '6c272730dec136ce350d145c4f1d12b15fc5a30632b8996a1cf01de6a0971116';
const CURRENT_ENGINE_MIGRATIONS = [{
  file: 'supabase/migrations/20261010_100000_agent_current_engine_only.sql',
  sha256: '6d78410e8a10b710bc9d03a28920b6a066ea3c035e29b96d89bd72bac216fa06',
}];
const REVIEWED_CURRENT_ENGINE_SCHEMA_UPGRADES = [
  ...REVIEWED_PRE_CURRENT_ENGINE_SCHEMA_UPGRADES,
  ...REVIEWED_PRE_CURRENT_ENGINE_SCHEMA_UPGRADES.filter(entry => entry.current === REASONING_EFFORT_FINGERPRINT).map(entry => ({
    previous: entry.previous, current: CURRENT_ENGINE_FINGERPRINT, files: [...entry.files, ...CURRENT_ENGINE_MIGRATIONS],
  })),
  { previous: REASONING_EFFORT_FINGERPRINT, current: CURRENT_ENGINE_FINGERPRINT, files: CURRENT_ENGINE_MIGRATIONS },
];
// 2026-10-17：会话列表的 Agent 派生列（视图列 has_agent_run）。已存在的本地栈据此就地补这条迁移。
const CONVERSATION_CATEGORY_MIGRATIONS = [{
  file: 'supabase/migrations/20261017_100000_conversation_list_agent_flag.sql',
  sha256: '0072eda3b0ef2520cf5893b275f083b9cca43d6e42f72f7f65e011e6f7da64b7',
}];
const CONVERSATION_CATEGORY_FINGERPRINT = 'f4045b14c41f1384c1d3e3b2a5984a42be782e8e5fe46c4cc7a1adb6adba9008';
const REVIEWED_CONVERSATION_CATEGORY_SCHEMA_UPGRADES = [
  ...REVIEWED_CURRENT_ENGINE_SCHEMA_UPGRADES,
  ...REVIEWED_CURRENT_ENGINE_SCHEMA_UPGRADES.filter(entry => entry.current === CURRENT_ENGINE_FINGERPRINT).map(entry => ({
    previous: entry.previous, current: CONVERSATION_CATEGORY_FINGERPRINT, files: [...entry.files, ...CONVERSATION_CATEGORY_MIGRATIONS],
  })),
  { previous: CURRENT_ENGINE_FINGERPRINT, current: CONVERSATION_CATEGORY_FINGERPRINT, files: CONVERSATION_CATEGORY_MIGRATIONS },
];
// 2026-10-19：公开只读分享（conversation_shares 表与三个 RPC）。已存在的本地栈据此就地补这条迁移。
const CONVERSATION_SHARE_MIGRATIONS = [{
  file: 'supabase/migrations/20261019_100000_conversation_shares.sql',
  sha256: '38998e70bca24541263e54d788ca46c1b0a2537b66cae65b2892658c2a907d43',
}];
const CONVERSATION_SHARE_FINGERPRINT = 'cf8f3676ea50b7cb9f1df6e433a1991b6da8cb54c8ef158331534ea1f08a4b45';
const REVIEWED_CONVERSATION_SHARE_SCHEMA_UPGRADES = [
  ...REVIEWED_CONVERSATION_CATEGORY_SCHEMA_UPGRADES,
  ...REVIEWED_CONVERSATION_CATEGORY_SCHEMA_UPGRADES.filter(entry => entry.current === CONVERSATION_CATEGORY_FINGERPRINT).map(entry => ({
    previous: entry.previous, current: CONVERSATION_SHARE_FINGERPRINT, files: [...entry.files, ...CONVERSATION_SHARE_MIGRATIONS],
  })),
  { previous: CONVERSATION_CATEGORY_FINGERPRINT, current: CONVERSATION_SHARE_FINGERPRINT, files: CONVERSATION_SHARE_MIGRATIONS },
];
// 2026-10-20：Pi Durable 1.3.0 引擎代际（心跳、创建与认领只认 1.3.0，在途 1.1.0 任务按原规则结算）。
const PI_DURABLE_1_3_MIGRATIONS = [{
  file: 'supabase/migrations/20261020_100000_agent_pi_durable_1_3.sql',
  sha256: '654f1445606b17dc14ae84ac34d188698242ad74aa1b82ff6736c89b44031fe9',
}];
const PI_DURABLE_1_3_FINGERPRINT = 'a965a7c1177ad5d6aae386fd69ddfc6ea20883d39942b848676a6e1d8d65824e';
const REVIEWED_PI_DURABLE_1_3_SCHEMA_UPGRADES = [
  ...REVIEWED_CONVERSATION_SHARE_SCHEMA_UPGRADES,
  ...REVIEWED_CONVERSATION_SHARE_SCHEMA_UPGRADES.filter(entry => entry.current === CONVERSATION_SHARE_FINGERPRINT).map(entry => ({
    previous: entry.previous, current: PI_DURABLE_1_3_FINGERPRINT, files: [...entry.files, ...PI_DURABLE_1_3_MIGRATIONS],
  })),
  { previous: CONVERSATION_SHARE_FINGERPRINT, current: PI_DURABLE_1_3_FINGERPRINT, files: PI_DURABLE_1_3_MIGRATIONS },
];
// 2026-10-20：命盘改由用户在盘面上保存；结算不再存盘，去掉 agent_finish_run 的 p_record、agent_cache_tool 的 p_chart 与产物表的三个命盘列。
const USER_SAVED_CHART_MIGRATIONS = [{
  file: 'supabase/migrations/20261020_120000_agent_user_saved_charts.sql',
  sha256: '55ad3521aad922853bd3535a4f87c6e37430498b383ac4b045c366effea43842',
}];
const USER_SAVED_CHART_FINGERPRINT = '3835fe3cba2c2df7f8315b8ad7a69b4c50c1c04c14592b81d1abccef92c20a4f';
const REVIEWED_USER_SAVED_CHART_SCHEMA_UPGRADES = [
  ...REVIEWED_PI_DURABLE_1_3_SCHEMA_UPGRADES,
  ...REVIEWED_PI_DURABLE_1_3_SCHEMA_UPGRADES.filter(entry => entry.current === PI_DURABLE_1_3_FINGERPRINT).map(entry => ({
    previous: entry.previous, current: USER_SAVED_CHART_FINGERPRINT, files: [...entry.files, ...USER_SAVED_CHART_MIGRATIONS],
  })),
  { previous: PI_DURABLE_1_3_FINGERPRINT, current: USER_SAVED_CHART_FINGERPRINT, files: USER_SAVED_CHART_MIGRATIONS },
];
// 2026-10-21：管理员只读的任务日志（设置中心「Agent 任务」重建任务树）；不改表、列与策略。
const ADMIN_TASK_LOG_MIGRATIONS = [{
  file: 'supabase/migrations/20261021_100000_agent_admin_task_log.sql',
  sha256: 'e8047ae94b905454941103ffb354e96dd793a9955981d188ebf0c25b744f39cc',
}];
const ADMIN_TASK_LOG_FINGERPRINT = '2e4f0aa1231713b4e40f2662ad5bc4068b4aa190526533ed15174004cf64b388';
const REVIEWED_SCHEMA_UPGRADES = [
  ...REVIEWED_USER_SAVED_CHART_SCHEMA_UPGRADES,
  ...REVIEWED_USER_SAVED_CHART_SCHEMA_UPGRADES.filter(entry => entry.current === USER_SAVED_CHART_FINGERPRINT).map(entry => ({
    previous: entry.previous, current: ADMIN_TASK_LOG_FINGERPRINT, files: [...entry.files, ...ADMIN_TASK_LOG_MIGRATIONS],
  })),
  { previous: USER_SAVED_CHART_FINGERPRINT, current: ADMIN_TASK_LOG_FINGERPRINT, files: ADMIN_TASK_LOG_MIGRATIONS },
];

export function reviewedSchemaUpgrade(fingerprint, bundle) {
  return REVIEWED_SCHEMA_UPGRADES.find(entry => entry.previous === fingerprint && entry.current === bundle.fingerprint) ?? null;
}

export function matchesSchemaFingerprint(fingerprint, bundle) {
  const valid = /^[a-f0-9]{64}$/;
  if (!valid.test(fingerprint) || !valid.test(bundle.fingerprint)) return false;
  if (fingerprint === bundle.fingerprint) return true;
  const sqlContract = digest(JSON.stringify([
    bundle.application.replace(/^COMMENT ON SCHEMA public IS 'taibu-selfhost-v1:[a-f0-9]{64}';\n/m, ''),
    bundle.migration,
    bundle.storage,
  ]));
  return REVIEWED_SCHEMA_EQUIVALENCES.some(entry => entry.previous === fingerprint
    && entry.current === bundle.fingerprint && entry.sqlContract === sqlContract);
}

async function application(run, bundle) {
  const fingerprint = (await run.sql('SELECT coalesce(fingerprint,\'\') FROM local_stack.state')).trim();
  if (fingerprint && !matchesSchemaFingerprint(fingerprint, bundle)) {
    const upgrade = reviewedSchemaUpgrade(fingerprint, bundle);
    if (!upgrade) throw new Error('数据库与当前基线哈希不匹配；请使用独立项目，不可重放基线');
    const files = upgrade.files ?? [{ file: upgrade.file, sha256: upgrade.sha256 }];
    const migrations = await Promise.all(files.map(async entry => {
      const content = await readFile(path.join(ROOT, entry.file), 'utf8');
      if (digest(content) !== entry.sha256) throw new Error('本地升级迁移校验不匹配，拒绝执行');
      return content.replace(/^BEGIN;\s*$/gm, '').replace(/^COMMIT;\s*$/gm, '');
    }));
    await run.sql(`BEGIN;\n${migrations.join('\n')}\nUPDATE local_stack.state SET fingerprint=${quote(bundle.fingerprint)};\nCOMMIT;`, 'Agent 体验与能力迁移');
    return;
  }
  if (fingerprint) return;
  // Baseline and guard commit atomically; interrupted initialization is resumable.
  await run.sql(`BEGIN;\n${bundle.application}\n${bundle.migration}\nGRANT USAGE ON SCHEMA public, extensions TO taibu_vector_owner;
-- PostgreSQL requires schema CREATE as well as table ownership for CREATE INDEX.
-- This trusted maintenance identity is never granted to application API roles.
GRANT CREATE ON SCHEMA public TO taibu_vector_owner;
ALTER TABLE public.knowledge_entries OWNER TO taibu_vector_owner;
UPDATE local_stack.state SET fingerprint=${quote(bundle.fingerprint)};\nCOMMIT;`, '应用基线与限流迁移');
}
async function seed(run, config) {
  if ((await run.sql('SELECT seeded FROM local_stack.state')).trim() === 't') return;
  for (const [email, password, admin] of [[config.ADMIN_EMAIL, config.ADMIN_PASSWORD, true], [config.USER_EMAIL, config.USER_PASSWORD, false], [config.USER2_EMAIL, config.USER2_PASSWORD, false]]) {
    const existing = (await run.sql(`SELECT id FROM auth.users WHERE email=${quote(email)}`)).trim();
    if (!existing) {
      const result = await fetch(`${config.APP_ORIGIN}/auth/v1/admin/users`, { method: 'POST', headers: { authorization: `Bearer ${config.SERVICE_KEY}`, apikey: config.SERVICE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
      await result.body?.cancel();
      if (!result.ok) throw new Error('初始化本地账号失败');
    }
    await run.sql(`INSERT INTO public.users(id,nickname,is_admin,membership,ai_chat_count) SELECT id,${quote(admin ? '本地管理员' : '本地测试用户')},${admin},'free',100 FROM auth.users WHERE email=${quote(email)} ON CONFLICT(id) DO UPDATE SET is_admin=EXCLUDED.is_admin,ai_chat_count=EXCLUDED.ai_chat_count;`);
  }
  if (config.DEMO_ENABLED === 'true') await run.sql(`BEGIN;
INSERT INTO public.ai_gateways(gateway_key,display_name,base_url,api_key_env_var,is_enabled) VALUES('newapi','本地离线演示','http://demo:8000/v1','NEWAPI_API_KEY',true) ON CONFLICT(gateway_key) DO UPDATE SET base_url=EXCLUDED.base_url,api_key_env_var=EXCLUDED.api_key_env_var,is_enabled=true;
INSERT INTO public.ai_models(model_key,display_name,vendor,required_tier,usage_type,routing_mode,supports_reasoning,reasoning_required_tier,is_reasoning_default,reasoning_effort_format,default_reasoning_effort,default_max_tokens,description)
VALUES('taibu-demo','本地离线演示','local','free','chat','newapi',true,'free',true,'reasoning_effort','medium',8192,'本地演示模型：支持努力程度档位')
ON CONFLICT(model_key) DO UPDATE SET supports_reasoning=EXCLUDED.supports_reasoning,reasoning_required_tier=EXCLUDED.reasoning_required_tier,is_reasoning_default=EXCLUDED.is_reasoning_default,reasoning_effort_format=EXCLUDED.reasoning_effort_format,default_reasoning_effort=EXCLUDED.default_reasoning_effort,default_max_tokens=EXCLUDED.default_max_tokens,description=EXCLUDED.description;
INSERT INTO public.ai_model_gateway_bindings(model_id,gateway_id,model_id_override) SELECT m.id,g.id,'taibu-demo' FROM public.ai_models m CROSS JOIN public.ai_gateways g WHERE m.model_key='taibu-demo' AND g.gateway_key='newapi' AND NOT EXISTS(SELECT 1 FROM public.ai_model_gateway_bindings b WHERE b.model_id=m.id AND b.gateway_id=g.id);
COMMIT;`);
  await run.sql('UPDATE local_stack.state SET seeded=true');
}
/**
 * 会话类别视图补丁：分叉会话复制了 Agent 消息但没有 agent_runs 记录。
 * 视图是 CREATE OR REPLACE，可重复执行；只在定义尚未包含消息检测时补一次。
 */
async function ensureConversationCategoryView(run) {
  const applied = (await run.sql("SELECT pg_get_viewdef('public.conversations_with_archive_status'::regclass) LIKE '%jsonb_typeof%'")).trim();
  if (applied === 't') return;
  const sql = await readFile(path.join(ROOT, 'supabase/migrations/20261018_090000_conversation_agent_flag_includes_forks.sql'), 'utf8');
  await run.sql(sql, '会话类别补全（分叉）');
}
/**
 * 本地演示栈的模型档位测试数据：幂等 upsert，重复启动不会重复插入。
 * 仅在 DEMO_ENABLED=true 的本地栈生效；不进入生产迁移。
 */
async function ensureDemoModels(run, config) {
  if (config.DEMO_ENABLED !== 'true') return;
  await run.sql(`BEGIN;
INSERT INTO public.ai_models(model_key,display_name,vendor,required_tier,usage_type,routing_mode,is_enabled,sort_order,supports_reasoning,reasoning_required_tier,is_reasoning_default,reasoning_effort_format,default_reasoning_effort,default_max_tokens,description) VALUES
 ('taibu-demo','本地离线演示','local','free','chat','newapi',true,1,true,'free',true,'reasoning_effort','medium',8192,'本地演示模型：支持努力程度档位'),
 ('taibu-demo-effort','本地推理演示','local','free','chat','newapi',true,10,true,'free',true,'reasoning_effort','medium',8192,'测试模型：支持努力程度档位'),
 ('taibu-demo-deep','本地深度演示','local','free','chat','newapi',true,11,true,'free',false,'reasoning_effort','high',8192,'测试模型：支持努力程度档位'),
 ('taibu-demo-fast','本地快速演示','local','free','chat','newapi',true,12,false,'free',false,NULL,NULL,4096,'测试模型：不支持推理')
ON CONFLICT(model_key) DO UPDATE SET display_name=EXCLUDED.display_name,is_enabled=true,sort_order=EXCLUDED.sort_order,supports_reasoning=EXCLUDED.supports_reasoning,reasoning_required_tier=EXCLUDED.reasoning_required_tier,is_reasoning_default=EXCLUDED.is_reasoning_default,reasoning_effort_format=EXCLUDED.reasoning_effort_format,default_reasoning_effort=EXCLUDED.default_reasoning_effort,default_max_tokens=EXCLUDED.default_max_tokens,description=EXCLUDED.description;
-- 每个演示模型按自己的 model_key 请求离线演示服务：协作成员各自报告实际模型，演示服务不校验模型名。
INSERT INTO public.ai_model_gateway_bindings(model_id,gateway_id,model_id_override)
SELECT m.id,g.id,m.model_key FROM public.ai_models m CROSS JOIN public.ai_gateways g
WHERE m.model_key IN ('taibu-demo-effort','taibu-demo-deep','taibu-demo-fast') AND g.gateway_key='newapi'
  AND NOT EXISTS(SELECT 1 FROM public.ai_model_gateway_bindings b WHERE b.model_id=m.id AND b.gateway_id=g.id);
UPDATE public.ai_model_gateway_bindings b SET model_id_override=m.model_key FROM public.ai_models m, public.ai_gateways g
WHERE b.model_id=m.id AND b.gateway_id=g.id AND g.gateway_key='newapi' AND m.model_key IN ('taibu-demo-effort','taibu-demo-deep','taibu-demo-fast')
  AND b.model_id_override IS DISTINCT FROM m.model_key;
COMMIT;`);
}
export async function withStorageMigrationPrivilege(sql, migrate) {
  try {
    await sql('GRANT CREATE ON DATABASE taibu TO supabase_storage_admin;', '文件存储迁移临时授权');
    await migrate();
  } finally {
    // Must finish before web/scheduler starts; never retain migration privilege.
    await sql('REVOKE CREATE ON DATABASE taibu FROM supabase_storage_admin;', '撤销文件存储迁移临时授权');
  }
}
export async function refreshRestSchema(sql) {
  await sql("NOTIFY pgrst, 'reload schema';", 'REST schema 缓存刷新');
}
async function up(state, run, build = false) {
  try {
    await lstat(path.join(state.directory, 'restore-pending'));
    throw new Error('该项目恢复未完成；禁止启动，请选择新的恢复目标');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bundle = await schemaBundle();
  await assertOwnedVolumes(state, run.env);
  await run.compose(['up', '-d', '--wait', 'db'], { phase: '数据库启动' });
  await bootstrapRoles(run, state.config);
  await ensureAppRole(run, state.config);
  // Recover a privilege left behind by an uncatchable previous process exit.
  await run.sql('REVOKE CREATE ON DATABASE taibu FROM supabase_storage_admin;', '清理文件存储迁移临时授权');
  await run.compose(['up', '-d', 'auth', 'gateway'], { phase: '身份服务与网关启动' });
  await wait(() => httpReady(state.config.APP_ORIGIN, '/auth/v1/health'), '身份服务');
  await application(run, bundle);
  await ensureConversationCategoryView(run);
  await run.compose(['up', '-d', 'rest', 'redis'], { phase: 'REST 与 Redis 启动' });
  // Existing REST containers otherwise retain old column/RPC metadata after an upgrade.
  await refreshRestSchema(run.sql);
  const storageReady = (await run.sql('SELECT storage_ready FROM local_stack.state')).trim() === 't';
  const startStorage = async () => {
    await run.compose(['up', '-d', 'storage'], { phase: '文件存储启动与受控迁移' });
    await wait(() => httpReady(state.config.APP_ORIGIN, '/storage/v1/status'), '文件服务');
  };
  if (storageReady) await startStorage();
  else await withStorageMigrationPrivilege(run.sql, startStorage);
  if (!storageReady) await run.sql(`BEGIN;\n${bundle.storage}\nUPDATE local_stack.state SET storage_ready=true;\nCOMMIT;`, '文件存储策略初始化');
  await seed(run, state.config);
  // Temporary P1–P4 bridge: systemDb() impersonates the seeded administrator.
  state.systemUserId = (await run.sql('SELECT id FROM public.users WHERE is_admin ORDER BY created_at LIMIT 1')).trim();
  if (!state.systemUserId) throw new Error('未能确定本地系统管理员');
  await ensureDemoModels(run, state.config);
  await run.compose(['up', '-d', ...(build ? ['--build'] : []), 'functions', 'web', 'worker', ...(state.config.DEMO_ENABLED === 'true' ? ['demo'] : [])], { timeout: 1_200_000 });
  // Reload the bind-mounted offline model after a local code update.
  if (build && state.config.DEMO_ENABLED === 'true') await run.compose(['up', '-d', '--no-deps', '--force-recreate', 'demo']);
  await wait(() => httpReady(state.config.APP_ORIGIN, '/api/health'), '应用');
  await wait(() => httpReady(state.config.APP_ORIGIN, '/api/announcements?latest=1'), '应用数据库');
  await wait(async () => (await run.sql("SELECT EXISTS(SELECT 1 FROM public.agent_workers WHERE engine='pi-durable/1.3.0' AND heartbeat_at > now() - interval '30 seconds')")).trim() === 't', 'Agent worker');
  // The scheduler script is bind-mounted; recreating its stateless process
  // loads updated polling code even when its image/configuration did not change.
  await run.compose(['up', '-d', '--no-deps', '--force-recreate', 'scheduler']);
  console.log(`本地服务已就绪：${state.config.APP_ORIGIN}；账号见私有 credentials.json`);
}
async function backup(state, run, destination) {
  if (!destination || !path.isAbsolute(destination)) throw new Error('备份路径必须为新的绝对目录');
  await privateDirectory(destination, true);
  const running = JSON.parse(await run.compose(['ps', '--format', 'json']).then(value => value.trim().startsWith('[') ? value : `[${value.trim().split('\n').filter(Boolean).join(',')}]`));
  const active = running.filter(service => service.State === 'running' && service.Service !== 'db').map(service => service.Service);
  try {
    if (active.length) await run.compose(['stop', ...active]);
    const dump = await run.compose(['exec', '-T', 'db', 'pg_dump', '-U', 'postgres', '-d', 'taibu', '-Fc'], { binary: true, timeout: 300_000 });
    const storage = await run.compose(['run', '--rm', '-T', '--no-deps', 'maintenance', 'tar', '-czf', '-', '-C', '/storage', '.'], { binary: true, timeout: 300_000 });
    const attributes = await run.compose(['run', '--rm', '-T', '--no-deps', 'maintenance-attributes', 'capture'], { binary: true, timeout: 300_000, phase: '备份文件存储属性' });
    storageAttributes.validateAttributes(attributes);
    await writeFile(path.join(destination, 'storage-attributes.json'), attributes, { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(destination, 'database.dump'), dump, { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(destination, 'storage.tar.gz'), storage, { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(destination, 'config.json'), JSON.stringify(state.config), { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ version: 2, sourceProject: state.config.LOCAL_PROJECT, fingerprint: (await run.sql('SELECT fingerprint FROM local_stack.state')).trim(), sha256: { 'database.dump': digest(dump), 'storage.tar.gz': digest(storage), 'storage-attributes.json': digest(attributes), 'config.json': digest(JSON.stringify(state.config)) } }), { flag: 'wx', mode: 0o600 });
  } finally { if (active.length) await run.compose(['start', ...active]); }
  console.log('备份完成；包含账号与密钥，须按敏感数据保管。Redis 临时限流状态不备份。');
}
export function validateStorageArchive(compressed) {
  const archive = gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const validatePath = name => {
    if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) throw new Error('文件备份包含不安全路径或链接');
    return name;
  };
  const octal = field => {
    const value = field.toString('latin1').replace(/[\0 ]+$/g, '').trimStart();
    if (!/^[0-7]+$/.test(value)) throw new Error('文件备份数字字段无效');
    return Number.parseInt(value, 8);
  };
  if (archive.length % 512 !== 0) throw new Error('文件备份不完整');
  let pendingName;
  for (let offset = 0; offset < archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (pendingName !== undefined || archive.length - offset < 1024 || !archive.subarray(offset).every(byte => byte === 0)) throw new Error('文件备份结束标记无效');
      return;
    }
    const expectedChecksum = octal(header.subarray(148, 156));
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== expectedChecksum) throw new Error('文件备份头校验失败');
    const field = (start, length) => {
      const bytes = header.subarray(start, start + length);
      const end = bytes.indexOf(0);
      return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end));
    };
    const size = octal(header.subarray(124, 136));
    const nextOffset = offset + 512 + Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(size) || nextOffset > archive.length) throw new Error('文件备份不完整');
    const type = header[156];
    if (type === 76) { // GNU LongLink filename (L), never long symlink (K).
      if (pendingName !== undefined || size < 2 || size > 4096) throw new Error('文件备份长路径元数据无效');
      validatePath(field(0, 100));
      const payload = archive.subarray(offset + 512, offset + 512 + size);
      if (payload.at(-1) !== 0 || payload.subarray(0, -1).includes(0)) throw new Error('文件备份长路径终止符无效');
      pendingName = validatePath(decoder.decode(payload.subarray(0, -1)));
    } else {
      if (![0, 48, 53].includes(type) || (type === 53 && size !== 0) || field(157, 100)) throw new Error('文件备份包含不安全路径或链接');
      // POSIX ustar uses a prefix; GNU's old header uses that region for
      // timestamps, so never interpret its metadata as a path prefix.
      const prefix = header.subarray(257, 263).equals(Buffer.from('ustar\0')) ? field(345, 155) : '';
      const name = pendingName ?? [prefix, field(0, 100)].filter(Boolean).join('/');
      validatePath(name);
      pendingName = undefined; // Must apply to the immediately following file/dir.
    }
    offset = nextOffset;
  }
  throw new Error('文件备份缺少结束标记');
}
async function restore(source, project, port, env) {
  if (!source || !path.isAbsolute(source) || !project || !port) throw new Error('恢复必须指定绝对备份路径、独立 --target 和 --port');
  validateProject(project); validatePort(port);
  const manifest = JSON.parse(await privateRead(path.join(source, 'manifest.json')));
  if (manifest.version !== 2 || project === manifest.sourceProject) throw new Error('禁止覆盖来源项目；仅支持含文件属性的 v2 完整备份');
  const bundle = await schemaBundle();
  if (!matchesSchemaFingerprint(manifest.fingerprint, bundle)) throw new Error('备份基线版本不匹配');
  const files = {};
  for (const name of ['database.dump', 'storage.tar.gz', 'storage-attributes.json', 'config.json']) {
    files[name] = await privateRead(path.join(source, name));
    if (digest(files[name]) !== manifest.sha256[name]) throw new Error('备份文件校验失败');
  }
  validateStorageArchive(files['storage.tar.gz']);
  storageAttributes.validateAttributes(files['storage-attributes.json']);
  const config = validateConfig(JSON.parse(files['config.json']));
  if (String(port) === config.APP_PORT) throw new Error('恢复项目须使用独立端口');
  config.LOCAL_INSTANCE_ID = secret(); config.LOCAL_PROJECT = project; config.APP_PORT = validatePort(port); config.APP_ORIGIN = `http://127.0.0.1:${config.APP_PORT}`;
  const state = { directory: path.join(STATE, project), config };
  await assertOwnedVolumes(state, env, true);
  await privateDirectory(STATE);
  await privateDirectory(state.directory, true);
  const lock = path.join(state.directory, '.lock');
  await mkdir(lock, { mode: 0o700 });
  try {
  await saveConfig(state.directory, config);
  await writeFile(path.join(state.directory, 'restore-pending'), '恢复进行中\n', { flag: 'wx', mode: 0o600 });
  const run = runner(state, env);
  await run.compose(['up', '-d', '--wait', 'db'], { phase: '数据库启动' });
  await bootstrapRoles(run, config);
  // Empty newly created target only. Drop our bootstrap placeholders, not source data.
  await run.sql('DROP SCHEMA local_stack CASCADE; DROP SCHEMA auth; DROP SCHEMA storage; DROP SCHEMA extensions CASCADE;');
  await run.compose(['exec', '-T', 'db', 'pg_restore', '--exit-on-error', '--single-transaction', '-U', 'postgres', '-d', 'taibu'], { input: files['database.dump'], timeout: 300_000 });
  await run.compose(['run', '--rm', '-T', '--no-deps', 'maintenance', 'tar', '-xzf', '-', '-C', '/storage'], { input: files['storage.tar.gz'], timeout: 300_000 });
  await run.compose(['run', '--rm', '-T', '--no-deps', 'maintenance-attributes', 'restore'], { input: files['storage-attributes.json'], timeout: 300_000, phase: '恢复并核验文件存储属性' });
  await run.sql(`UPDATE local_stack.state SET instance_id=${quote(config.LOCAL_INSTANCE_ID)}`);
  await rm(path.join(state.directory, 'restore-pending'));
  console.log(`备份已恢复至独立项目 ${project}；执行 up 启动，来源项目未修改。`);
  } finally { await rm(lock, { recursive: true }); }
}
export function summarizeLogs(text) {
  const lines = text.split('\n').filter(Boolean).slice(-100);
  return { lines: lines.length, errors: lines.filter(line => /\b(error|fatal|panic)\b|"level":(?:50|60)/i.test(line)).length, warnings: lines.filter(line => /\bwarn(?:ing)?\b|"level":40/i.test(line)).length };
}
async function observations(run, includeLogs = false) {
  const raw = (await run.compose(['ps', '--all', '--format', 'json'], { phase: '读取服务状态' })).trim();
  const rows = JSON.parse(raw.startsWith('[') ? raw : `[${raw.split('\n').filter(Boolean).join(',')}]`);
  const services = new Set(['db', 'auth', 'rest', 'storage', 'redis', 'functions', 'web', 'worker', 'gateway', 'scheduler', 'demo', 'maintenance']);
  for (const row of rows) {
    if (!services.has(row.Service)) continue;
    const status = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(row.State) ? row.State : 'unknown';
    const health = ['healthy', 'unhealthy', 'starting'].includes(row.Health) ? row.Health : '无探针';
    const exitCode = Number.isInteger(row.ExitCode) ? row.ExitCode : '未知';
    console.log(`${row.Service}：${status}；健康=${health}；退出码=${exitCode}`);
    if (includeLogs) {
      const output = await run.compose(['logs', '--no-color', '--tail', '100', row.Service], { phase: '读取有限日志' });
      const summary = summarizeLogs(output);
      // Never emit arbitrary log strings (including request/error bodies). Local
      // Docker keeps rotated diagnostics; CLI only publishes controlled counts.
      console.log(`  最近日志=${summary.lines}；错误=${summary.errors}；警告=${summary.warnings}`);
    }
  }
  if (!rows.length) console.log('没有运行中的服务');
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const allowed = { init: ['project', 'port', 'demo'], up: ['project', 'build'], status: ['project'], logs: ['project'], down: ['project'], backup: ['project', 'output'], restore: ['input', 'target', 'port'] };
  if (!allowed[command]) throw new Error('用法：selfhost init|up|status|logs|down|backup|restore [参数]');
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index].replace(/^--/, '');
    if (!rest[index].startsWith('--') || !allowed[command].includes(key) || key in options) throw new Error('参数无效或重复');
    options[key] = ['demo', 'build'].includes(key) ? true : rest[++index];
    if (options[key] === undefined || String(options[key]).startsWith('--')) throw new Error('参数缺少值');
  }
  const project = options.project ?? 'taibu-local';
  if (command === 'init') { await initialize(project, options.port ?? '3080', options.demo); console.log('本地配置已生成；密钥与账号仅保存在私有 .taibu-local 项目目录。'); return; }
  const env = await localDocker();
  if (command === 'restore') { await restore(options.input, options.target, options.port, env); return; }
  const state = await load(project);
  const lock = path.join(state.directory, '.lock');
  await mkdir(lock, { mode: 0o700 });
  try {
    const run = runner(state, env);
    await assertOwnedVolumes(state, env);
    if (command === 'up') await up(state, run, options.build);
    if (command === 'down') { await run.compose(['down']); console.log('容器与网络已停止并移除，所有持久数据卷保留。'); }
    if (command === 'status' || command === 'logs') await observations(run, command === 'logs');
    if (command === 'backup') await backup(state, run, options.output);
  } finally { await rm(lock, { recursive: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error && !error.code && /^[一-鿿]/.test(error.message) ? error.message : '本地操作失败；请检查路径、权限和项目状态'); process.exitCode = 1; });
