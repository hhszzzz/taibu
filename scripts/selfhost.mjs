#!/usr/bin/env node
// Local self-hosted stack orchestrator (Docker Compose + PostgreSQL + Redis).
//
// The old Supabase emulation (GoTrue/PostgREST/storage/functions) is gone. This
// script owns only: private per-project config, env files, and compose calls.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.taibu-local');
const COMPOSE_FILES = ['deploy/compose.base.yml', 'deploy/compose.local.yml'];
const APP_IMAGE = 'taibu-local';

const secret = () => randomBytes(32).toString('hex');

export function validateProject(value) {
  if (typeof value !== 'string' || value !== value.trim() || !/^taibu-[a-z0-9][a-z0-9-]{0,39}$/u.test(value)) {
    throw new Error('项目名须以 taibu- 开头，仅限小写字母、数字和连字符');
  }
  return value;
}

export function validatePort(value) {
  const text = String(value);
  if (text !== text.trim() || !/^\d+$/u.test(text) || Number(text) < 1024 || Number(text) > 65535) {
    throw new Error('端口须为 1024–65535');
  }
  return String(Number(text));
}

export function validateEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('端点必须是 HTTP(S) 且不含凭据');
  }
  if (value !== url.origin && value !== `${url.origin}/`) throw new Error('端点必须是 origin');
  return url.origin;
}

export function validateResourceOwnership(marker, instance, requireAbsent = false) {
  if (requireAbsent) throw new Error('目标已有 Docker 资源，拒绝覆盖');
  if (marker !== instance) throw new Error('Docker 资源缺少当前实例归属标记，拒绝接管');
}

export function containerNameFilter(project) {
  validateProject(project);
  return `name=^/${project}-(db|redis|db-setup|migrate|web|worker|mailpit)-([0-9]+|run-[a-z0-9]+)$`;
}

export function summarizeLogs(text) {
  // Never echo credentials or query strings from log lines.
  return String(text)
    .split('\n')
    .map((line) => line
      .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gu, '$1***@')
      .replace(/(redis:\/\/:?)[^@\s]+@/gu, '$1***@')
      .replace(/((?:password|secret|token|key)=)[^\s&]+/giu, '$1***'))
    .join('\n');
}

export function createConfig(project, port = '3080', demo = false) {
  const appPort = validatePort(port);
  const config = {
    LOCAL_INSTANCE_ID: secret(),
    LOCAL_PROJECT: validateProject(project),
    APP_PORT: appPort,
    APP_ORIGIN: `http://127.0.0.1:${appPort}`,
    DEMO_ENABLED: demo ? 'true' : 'false',
    ADMIN_EMAIL: 'admin@taibu.local',
    USER_EMAIL: 'user@taibu.local',
    USER2_EMAIL: 'user2@taibu.local',
    DB_HOST_PORT: '54329',
    MAILPIT_PORT: '8025',
  };
  for (const key of [
    'DB_PASSWORD',
    'TAIBU_MIGRATOR_PASSWORD',
    'TAIBU_APP_PASSWORD',
    'TAIBU_AUTH_PASSWORD',
    'TAIBU_BACKUP_PASSWORD',
    'REDIS_PASSWORD',
    'BETTER_AUTH_SECRET',
    'INTERNAL_API_SECRET',
    'ADMIN_PASSWORD',
    'USER_PASSWORD',
    'USER2_PASSWORD',
  ]) config[key] = secret();
  config.AGENT_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  return config;
}

export function validateConfig(config) {
  const expected = Object.keys(createConfig('taibu-validation', '3080')).sort();
  if (!config || JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(expected)) {
    throw new Error('本地配置字段无效');
  }
  validateProject(config.LOCAL_PROJECT);
  validatePort(config.APP_PORT);
  validatePort(config.DB_HOST_PORT);
  validatePort(config.MAILPIT_PORT);
  if (config.APP_ORIGIN !== `http://127.0.0.1:${config.APP_PORT}` || !['true', 'false'].includes(config.DEMO_ENABLED)) {
    throw new Error('本地配置地址无效');
  }
  if (Buffer.from(config.AGENT_CREDENTIAL_ENCRYPTION_KEY, 'base64').length !== 32
    || Buffer.from(config.AGENT_CREDENTIAL_ENCRYPTION_KEY, 'base64').toString('base64') !== config.AGENT_CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error('Agent 加密密钥格式无效');
  }
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || /[\r\n$`\\]/u.test(value)) throw new Error('本地配置值无效');
    if (key.endsWith('_PASSWORD') || ['LOCAL_INSTANCE_ID', 'BETTER_AUTH_SECRET', 'INTERNAL_API_SECRET'].includes(key)) {
      if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('本地密钥格式无效');
    }
  }
  for (const email of [config.ADMIN_EMAIL, config.USER_EMAIL, config.USER2_EMAIL]) {
    if (!/^[a-z0-9.]+@taibu\.local$/u.test(email)) throw new Error('种子账号配置无效');
  }
  return config;
}

export async function localDocker() {
  const version = await execute('docker', ['version', '--format', '{{.Server.Version}}']);
  await execute('docker', ['compose', 'version']);
  return { ...process.env, DOCKER_SERVER_VERSION: String(version).trim() };
}

export function execute(command, args, { input, env = process.env, binary = false, timeout = 120_000, phase } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { env, timeout, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message).trim().split('\n').slice(-6).join('\n');
          reject(new Error(`本地操作失败（${phase ?? (command === 'docker' ? 'Docker' : '校验')}）：${detail}`));
          return;
        }
        resolve(binary ? stdout : String(stdout).trim());
      });
    child.stdin?.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin?.end(input);
  });
}

function projectDirectory(project) {
  return path.join(STATE, validateProject(project));
}

async function privateDirectory(directory, exclusive = false) {
  if (exclusive) await mkdir(directory, { mode: 0o700 });
  else await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
    throw new Error('私有目录所有权或类型不安全');
  }
  await chmod(directory, 0o700);
}

async function writePrivate(file, content) {
  await writeFile(file, content, { mode: 0o600 });
  await chmod(file, 0o600);
}

async function readConfig(project) {
  const file = path.join(projectDirectory(project), 'config.json');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) {
    throw new Error('config.json 必须是当前用户的 0600 私有文件');
  }
  return validateConfig(JSON.parse(await readFile(file, 'utf8')));
}

function envFile(entries) {
  return `${Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value).replace(/\n/gu, ' ')}`)
    .join('\n')}\n`;
}

const PASSTHROUGH = [
  'NEWAPI_BASE_URL', 'NEWAPI_API_KEY', 'OCTOPUS_BASE_URL', 'OCTOPUS_API_KEY',
  'TAVILY_API_KEY', 'LINUXDO_CLIENT_ID', 'LINUXDO_CLIENT_SECRET',
  'AMAP_WEB_SERVICE_KEY', 'MINGAI_FALLBACK_MODELS_JSON',
];

/** Rewrites every env file from config.json. Safe to call before each compose run. */
async function writeEnvironment(config) {
  const directory = projectDirectory(config.LOCAL_PROJECT);
  const env = path.join(directory, 'env');
  await privateDirectory(directory);
  await privateDirectory(env, true).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
    await privateDirectory(env);
  });

  const passthrough = Object.fromEntries(PASSTHROUGH
    .map((key) => [key, process.env[key]])
    .filter(([, value]) => value));

  await writePrivate(path.join(env, 'app.env'), envFile({
    APP_ORIGIN: config.APP_ORIGIN,
    AUTH_ALLOW_INSECURE_LOCAL_HTTP: 'true',
    DATABASE_URL: `postgres://taibu_app:${config.TAIBU_APP_PASSWORD}@db:5432/taibu`,
    AUTH_DATABASE_URL: `postgres://taibu_auth:${config.TAIBU_AUTH_PASSWORD}@db:5432/taibu`,
    REDIS_URL: `redis://:${config.REDIS_PASSWORD}@redis:6379`,
    BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET,
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_ROOT: '/data/files',
    EMAIL_TRANSPORT: 'mailpit',
    SMTP_HOST: 'mailpit',
    SMTP_PORT: '1025',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'Taibu <no-reply@taibu.local>',
    INTERNAL_API_SECRET: config.INTERNAL_API_SECRET,
    AGENT_CREDENTIAL_ENCRYPTION_KEY: config.AGENT_CREDENTIAL_ENCRYPTION_KEY,
    AGENT_WORKER_CONCURRENCY: '2',
    DAILY_BRIEFING_ENABLED: 'false',
    VECTOR_SEARCH_ENABLED: 'false',
    ...passthrough,
  }));
  await writePrivate(path.join(env, 'db.env'), envFile({
    POSTGRES_PASSWORD: config.DB_PASSWORD,
    TAIBU_MIGRATOR_PASSWORD: config.TAIBU_MIGRATOR_PASSWORD,
    TAIBU_APP_PASSWORD: config.TAIBU_APP_PASSWORD,
    TAIBU_AUTH_PASSWORD: config.TAIBU_AUTH_PASSWORD,
    TAIBU_BACKUP_PASSWORD: config.TAIBU_BACKUP_PASSWORD,
  }));
  await writePrivate(path.join(env, 'db-setup.env'), envFile({
    ADMIN_DATABASE_URL: `postgres://postgres:${config.DB_PASSWORD}@db:5432/taibu`,
    TAIBU_MIGRATOR_PASSWORD: config.TAIBU_MIGRATOR_PASSWORD,
    TAIBU_APP_PASSWORD: config.TAIBU_APP_PASSWORD,
    TAIBU_AUTH_PASSWORD: config.TAIBU_AUTH_PASSWORD,
    TAIBU_BACKUP_PASSWORD: config.TAIBU_BACKUP_PASSWORD,
  }));
  await writePrivate(path.join(env, 'migrate.env'), envFile({
    MIGRATOR_DATABASE_URL: `postgres://taibu_migrator:${config.TAIBU_MIGRATOR_PASSWORD}@db:5432/taibu`,
  }));
  await writePrivate(path.join(env, 'redis.env'), envFile({ REDIS_PASSWORD: config.REDIS_PASSWORD }));
  await writePrivate(path.join(directory, 'compose.env'), envFile({
    LOCAL_PROJECT: config.LOCAL_PROJECT,
    LOCAL_INSTANCE_ID: config.LOCAL_INSTANCE_ID,
    TAIBU_ENV_DIR: env,
    TAIBU_SOURCE_DIR: ROOT,
    TAIBU_IMAGE: APP_IMAGE,
    TAIBU_TAG: 'local',
    APP_PORT: config.APP_PORT,
    DB_HOST_PORT: config.DB_HOST_PORT,
    MAILPIT_PORT: config.MAILPIT_PORT,
  }));
}

async function initialize(project, port, demo) {
  const config = createConfig(project, port, demo);
  const directory = projectDirectory(project);
  await privateDirectory(directory, true);
  await writePrivate(path.join(directory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  await writeEnvironment(config);
  return config;
}

function composeArguments(project) {
  const directory = projectDirectory(project);
  return [
    'compose',
    '--project-directory', ROOT,
    '--env-file', path.join(directory, 'compose.env'),
    ...COMPOSE_FILES.flatMap((file) => ['-f', path.join(ROOT, file)]),
    '-p', project,
  ];
}

async function compose(project, args, options = {}) {
  return await execute('docker', [...composeArguments(project), ...args], options);
}

async function assertOwnedProject(project, env) {
  const config = await readConfig(project);
  const label = `io.taibu.local.instance=${config.LOCAL_INSTANCE_ID}`;
  const ids = (await execute('docker', ['ps', '-aq', '--filter', `label=${label}`], { env })).split('\n').filter(Boolean);
  const volumes = (await execute('docker', ['volume', 'ls', '-q', '--filter', `label=${label}`], { env })).split('\n').filter(Boolean);
  for (const id of ids) {
    const marker = await execute('docker', ['inspect', '--format', '{{index .Config.Labels "io.taibu.local.instance"}}', id], { env });
    validateResourceOwnership(marker.trim(), config.LOCAL_INSTANCE_ID);
  }
  for (const id of volumes) {
    const marker = await execute('docker', ['volume', 'inspect', '--format', '{{index .Labels "io.taibu.local.instance"}}', id], { env });
    validateResourceOwnership(marker.trim(), config.LOCAL_INSTANCE_ID);
  }
  return config;
}

async function up(project, build) {
  let config;
  try {
    config = await readConfig(project);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = await initialize(project, '3080', false);
  }
  const env = await localDocker();
  await assertOwnedProject(project, env);
  await writeEnvironment(config);
  await compose(project, ['up', '-d', ...(build ? ['--build'] : [])], { phase: '启动' });
  console.log(`本地栈已启动：${config.APP_ORIGIN}（邮件预览 http://127.0.0.1:${config.MAILPIT_PORT}）`);
}

async function loadAndGuard(project) {
  await readConfig(project);
  const env = await localDocker();
  await assertOwnedProject(project, env);
  return env;
}

async function observations(project, logs) {
  if (logs) {
    const text = await compose(project, ['logs', '--no-color', '--tail', '200'], { phase: '日志' });
    console.log(summarizeLogs(text));
    return;
  }
  const text = await compose(project, ['ps'], { phase: '状态' });
  console.log(text || '没有运行中的服务');
}

async function backup(project, output) {
  if (!output) throw new Error('backup 需要 --output <文件>');
  const target = path.resolve(output);
  await mkdir(path.dirname(target), { recursive: true });
  const data = await compose(project, ['exec', '-T', 'db', 'pg_dump', '-U', 'postgres', '-Fc', 'taibu'], {
    binary: true, phase: '备份', timeout: 600_000,
  });
  await writePrivate(target, data);
  console.log(`备份已写入 ${target}`);
}

async function restore(project, input) {
  if (!input) throw new Error('restore 需要 --input <文件>');
  const data = await readFile(path.resolve(input));
  await compose(project, ['exec', '-T', 'db', 'pg_restore', '-U', 'postgres', '-d', 'taibu', '--clean', '--if-exists', '--no-owner'], {
    input: data, binary: true, phase: '恢复', timeout: 600_000,
  });
  console.log('恢复完成');
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const allowed = {
    init: ['project', 'port', 'demo'],
    up: ['project', 'build'],
    update: ['project'],
    status: ['project'],
    logs: ['project'],
    down: ['project'],
    backup: ['project', 'output'],
    restore: ['project', 'input'],
  };
  if (!allowed[command]) throw new Error('用法：selfhost init|up|update|status|logs|down|backup|restore [参数]');
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flag.startsWith('--')) throw new Error('参数无效');
    const key = flag.slice(2);
    if (!allowed[command].includes(key) || key in options) throw new Error('参数无效或重复');
    if (['demo', 'build'].includes(key)) options[key] = true;
    else {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('参数缺少值');
      options[key] = value;
      index += 1;
    }
  }
  const project = validateProject(options.project ?? 'taibu-local');

  if (command === 'init') {
    await initialize(project, options.port ?? '3080', Boolean(options.demo));
    console.log('本地配置已生成；密钥与账号仅保存在私有 .taibu-local 项目目录。');
    return;
  }
  if (command === 'up') { await up(project, Boolean(options.build)); return; }
  if (command === 'update') { await up(project, true); return; }

  await loadAndGuard(project);
  if (command === 'down') {
    await compose(project, ['down'], { phase: '停止' });
    console.log('容器与网络已停止并移除，所有持久数据卷保留。');
  }
  if (command === 'status' || command === 'logs') await observations(project, command === 'logs');
  if (command === 'backup') await backup(project, options.output);
  if (command === 'restore') await restore(project, options.input);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : '本地操作失败');
    process.exitCode = 1;
  });
}
