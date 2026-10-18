import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import storageAttributes from '../selfhost/storage-attributes.cjs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { containerNameFilter, createConfig, validateConfig, validateEndpoint, validateProject, validatePort, validateStorageArchive, validateResourceOwnership, summarizeLogs, withStorageMigrationPrivilege, schemaBundle, matchesSchemaFingerprint, reviewedSchemaUpgrade } from '../selfhost.mjs';
import { routeFor, cleanHeaders } from '../selfhost/gateway.mjs';

test('Agent schema addition rejects previous baselines while preserving SQL drift checks', async () => {
  const bundle = await schemaBundle();
  const original = 'a9bd00e3c1d19991e5be5158f5fa2a9d313428cc60d42f8bb979f6a27a3c60d7';
  assert.equal(matchesSchemaFingerprint(bundle.fingerprint, bundle), true);
  assert.equal(matchesSchemaFingerprint(original, bundle), false);
  assert.equal(matchesSchemaFingerprint('f'.repeat(64), bundle), false);
  assert.equal(matchesSchemaFingerprint('', bundle), false);
  assert.equal(matchesSchemaFingerprint(original, { ...bundle, fingerprint: 'f'.repeat(64) }), false);
  for (const field of ['application', 'migration', 'storage']) {
    assert.equal(matchesSchemaFingerprint(original, { ...bundle, [field]: bundle[field] + '\nSELECT 1;' }), false);
  }
  const source = await readFile(new URL('../selfhost.mjs', import.meta.url), 'utf8');
  assert.match(source, /!matchesSchemaFingerprint\(fingerprint, bundle\)/);
  assert.match(source, /!matchesSchemaFingerprint\(manifest\.fingerprint, bundle\)/);
});

test('only reviewed Agent baselines can apply the ordered experience migrations', async () => {
  const bundle = await schemaBundle();
  const previous = '9a6fd07d2d17f61ee6669d20d4910f2b3b7c621d3d07d9ceeba2b0af26df90be';
  const upgrade = reviewedSchemaUpgrade(previous, bundle);
  assert.ok(upgrade);
  assert.equal(upgrade.files[0].file, 'supabase/migrations/20261007_100000_agent_chat_results.sql');
  assert.equal(upgrade.files.length, 16);
  assert.equal(upgrade.files.at(-1).file, 'supabase/migrations/20261017_100000_conversation_list_agent_flag.sql');
  for (const entry of upgrade.files) assert.equal(entry.sha256, createHash('sha256').update(await readFile(new URL(`../../${entry.file}`, import.meta.url))).digest('hex'));
  const current = reviewedSchemaUpgrade('e639cd6d5a7d70ed5450bd5ee5cc7cd44f3a0924b5b91ce33d719df2c99cec9f', bundle);
  assert.equal(current.files.length, 15);
  const previousExperience = reviewedSchemaUpgrade('6072a25ccaae42b489af7f836ec52d80e806906fa4e722d1a343577502afe3be', bundle);
  assert.equal(previousExperience.files.length, 6);
  assert.equal(previousExperience.files[0].file, 'supabase/migrations/20261008_100000_agent_question_dedupe.sql');
  const backend = reviewedSchemaUpgrade('aa23300ca84196b4c6e3a5ab0669168420c78be450c4ea8f5cc273ccc3687fc2', bundle);
  assert.equal(backend.files.length, 7);
  assert.equal(backend.files[0].file, 'supabase/migrations/20261007_190000_agent_backend_access.sql');
  const competence = reviewedSchemaUpgrade('abacc80319e797bcbe1a0bb40434f301d48c93492f2e3cd81dcc60bfb8c19f9b', bundle);
  assert.equal(competence.files.length, 5);
  assert.equal(competence.files[0].file, 'supabase/migrations/20261008_180000_agent_competence.sql');
  const experience = reviewedSchemaUpgrade('c49d95371d32c4da037a0ab2c5ca82bf188be438787baada29a484c1f45fa658', bundle);
  assert.equal(experience.files.length, 4);
  assert.equal(experience.files[0].file, 'supabase/migrations/20261009_100000_agent_pi_durable_1_1.sql');
  assert.equal(experience.files[0].sha256, createHash('sha256').update(await readFile(new URL('../../supabase/migrations/20261009_100000_agent_pi_durable_1_1.sql', import.meta.url))).digest('hex'));
  const durable = reviewedSchemaUpgrade('223d3ed92db07a499114b15eb8be07f258a1e54effc47ee0a1bb812ec7403824', bundle);
  assert.equal(durable.files.length, 3);
  assert.equal(durable.files[0].file, 'supabase/migrations/20261009_120000_ai_reasoning_effort_levels.sql');
  assert.equal(durable.files[0].sha256, createHash('sha256').update(await readFile(new URL('../../supabase/migrations/20261009_120000_ai_reasoning_effort_levels.sql', import.meta.url))).digest('hex'));
  const reasoning = reviewedSchemaUpgrade('29359295c5ffdf9c652bc33d766fbcb4a0456d712ed982fdc19b274a5d2ee8b6', bundle);
  // 这一档之后还会补上会话分类列（20261017_100000），因此链尾是该迁移而不是引擎迁移。
  const category = { file: 'supabase/migrations/20261017_100000_conversation_list_agent_flag.sql', sha256: '0072eda3b0ef2520cf5893b275f083b9cca43d6e42f72f7f65e011e6f7da64b7' };
  assert.equal(reasoning.files.length, 2);
  assert.equal(reasoning.files[0].file, 'supabase/migrations/20261010_100000_agent_current_engine_only.sql');
  assert.equal(reasoning.files[0].sha256, createHash('sha256').update(await readFile(new URL('../../supabase/migrations/20261010_100000_agent_current_engine_only.sql', import.meta.url))).digest('hex'));
  assert.equal(reasoning.files[1].file, category.file);
  assert.equal(reasoning.files[1].sha256, createHash('sha256').update(await readFile(new URL(`../../${category.file}`, import.meta.url))).digest('hex'));
  assert.ok([upgrade, current, previousExperience, backend, competence, experience, durable].every(entry => entry.files.at(-1).file === category.file));
  assert.equal(reviewedSchemaUpgrade('f'.repeat(64), bundle), null);
  assert.equal(reviewedSchemaUpgrade(previous, { ...bundle, fingerprint: 'f'.repeat(64) }), null);
  const source = await readFile(new URL('../selfhost.mjs', import.meta.url), 'utf8');
  assert.match(source, /digest\(content\) !== entry\.sha256/);
});

test('project-prefix siblings are not mistaken for owned containers', () => {
  const pattern = new RegExp(containerNameFilter('taibu-restore').slice('name='.length));
  assert.ok(pattern.test('/taibu-restore-web-1'));
  assert.ok(pattern.test('/taibu-restore-worker-1'));
  assert.ok(!pattern.test('/taibu-restore-v2-worker-1'));
  assert.ok(pattern.test('/taibu-restore-maintenance-attributes-run-abc123'));
  assert.ok(!pattern.test('/taibu-restore-v2-web-1'));
  assert.ok(!pattern.test('/taibu-restore-web-1-foreign'));
});

test('local config has independent random secrets, scoped project and loopback origin', () => {
  const first = createConfig('taibu-local', 3080);
  const second = createConfig('taibu-local', 3080);
  assert.notEqual(first.JWT_SECRET, second.JWT_SECRET);
  assert.notEqual(first.AUTH_DB_PASSWORD, first.VECTOR_DB_PASSWORD);
  assert.equal(first.APP_ORIGIN, 'http://127.0.0.1:3080');
  assert.equal(validateConfig(first), first);
  assert.throws(() => validateConfig({ ...first, DB_PASSWORD: '${REMOTE_SECRET}' }));
  assert.throws(() => validateConfig({ ...first, SERVICE_KEY: first.ANON_KEY }));
  assert.throws(() => validateConfig({ ...first, APP_ORIGIN: 'https://remote.example' }));
  assert.throws(() => validateConfig({ ...first, EXTRA: 'value' }));
});
test('reject remote endpoints and unsafe project/port inputs before operations', () => {
  assert.equal(validateEndpoint('unix:///var/run/docker.sock'), 'unix:///var/run/docker.sock');
  for (const endpoint of ['ssh://host', 'tcp://localhost:2375', 'unix://relative', 'unix:///x\ntcp://host']) assert.throws(() => validateEndpoint(endpoint));
  for (const project of ['production', '../taibu-local', 'taibu-a_b', 'taibu-']) assert.throws(() => validateProject(project));
  for (const port of ['80', '65536', '3080\n', 'abc']) assert.throws(() => validatePort(port));
});
test('gateway routes only fixed boundary-matched targets', () => {
  assert.deepEqual(routeFor('/auth/v1/token?grant_type=password'), { hostname: 'auth', port: 9999, path: '/token?grant_type=password' });
  assert.equal(routeFor('/rest/v1evil/table').hostname, 'web');
  assert.equal(routeFor('/storage/v1/object/a').hostname, 'storage');
  assert.equal(routeFor('/functions/v1/create-vector-index').hostname, 'functions');
  assert.equal(routeFor('/functions/v1/other').hostname, 'web');
});
test('gateway replaces forwarded/cloud IP hints and preserves Origin/auth', () => {
  const headers = cleanHeaders({ host: 'attacker.example', origin: 'http://127.0.0.1:3080', authorization: 'Bearer test', 'cf-connecting-ip': 'fake', 'x-vercel-forwarded-for': 'fake', 'x-forwarded-for': 'fake', 'x-real-ip': 'fake', forwarded: 'fake', connection: 'keep-alive, x-remove', 'x-remove': 'secret' }, '172.20.0.1', 'http://127.0.0.1:3080');
  assert.equal(headers['x-forwarded-for'], '172.20.0.1');
  assert.equal(headers['x-real-ip'], '172.20.0.1');
  assert.equal(headers.host, '127.0.0.1:3080');
  assert.equal(headers.origin, 'http://127.0.0.1:3080');
  assert.equal(headers.authorization, 'Bearer test');
  for (const key of ['cf-connecting-ip', 'x-vercel-forwarded-for', 'forwarded', 'connection', 'x-remove']) assert.equal(headers[key], undefined);
});
function tarEntry(name, type = '0', data = Buffer.alloc(0)) {
  const payload = Buffer.from(data);
  const buffer = Buffer.alloc(512 + Math.ceil(payload.length / 512) * 512);
  buffer.write(name, 0, 100);
  buffer.write(payload.length.toString(8).padStart(11, '0'), 124, 11);
  buffer.write(type, 156, 1);
  buffer.write('ustar  ', 257, 7); // BusyBox GNU format.
  buffer.fill(32, 148, 156);
  const checksum = buffer.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
  buffer.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  payload.copy(buffer, 512);
  return buffer;
}
function archive(name, type = '0') {
  return gzipSync(Buffer.concat([tarEntry(name, type), Buffer.alloc(1024)]));
}
function longEntry(name, type = '0', data = '') {
  return Buffer.concat([tarEntry('././@LongLink', 'L', Buffer.concat([Buffer.from(name), Buffer.from([0])])), tarEntry('truncated-name', type, data)]);
}
function packed(...entries) {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}
test('restore rejects traversal, absolute paths, symlinks and malformed tar', () => {
  validateStorageArchive(archive('./tenant/file'));
  for (const name of ['/etc/passwd', '../escape', './a/../../escape', 'a\\b']) assert.throws(() => validateStorageArchive(archive(name)));
  assert.throws(() => validateStorageArchive(archive('./link', '2')));
  assert.throws(() => validateStorageArchive(gzipSync(Buffer.from('broken'))));
});
test('compose exposes only loopback gateway and explicit service env', async () => {
  const compose = await readFile(new URL('../../docker-compose.local.yml', import.meta.url), 'utf8');
  assert.equal((compose.match(/^    ports:/gm) ?? []).length, 1);
  assert.match(compose, /127\.0\.0\.1:\$\{APP_PORT:\?\}:8000/);
  assert.doesNotMatch(compose, /container_name:|env_file:|network_mode: (?:host|service:)|\.env:/);
  assert.match(compose, /backend:\n    internal: true/);
  const web = compose.split('  web:')[1].split('  gateway:')[0];
  assert.doesNotMatch(web, /SUPABASE_DB_URL|VECTOR_DB_PASSWORD|DB_PASSWORD|JWT_SECRET/);
  assert.match(web, /RATE_LIMIT_BACKEND: redis/);
});
test('orchestration fail-closed guards and persistent down remain explicit', async () => {
  const source = await readFile(new URL('../selfhost.mjs', import.meta.url), 'utf8');
  assert.match(source, /\['down'\]/);
  assert.doesNotMatch(source, /\['down',\s*['"](?:-v|--volumes)/);
  assert.match(source, /--env-file/);
  assert.match(source, /!matchesSchemaFingerprint\(fingerprint, bundle\)/);
  assert.match(source, /requireAbsent/);
  assert.match(source, /project === manifest\.sourceProject/);
  assert.match(source, /flag: 'wx', mode: 0o600/);
  assert.match(source, /CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS/);
  assert.match(source, /ALTER TABLE public\.knowledge_entries OWNER TO taibu_vector_owner/);
});

test('namespace markers reject orphan resources and restore collisions', () => {
  validateResourceOwnership('instance-a', 'instance-a');
  assert.throws(() => validateResourceOwnership('', 'instance-a'));
  assert.throws(() => validateResourceOwnership('instance-b', 'instance-a'));
  assert.throws(() => validateResourceOwnership('instance-a', 'instance-a', true));
});
test('diagnostic summaries never include arbitrary log contents or credentials', () => {
  const config = createConfig('taibu-local', 3080);
  const result = summarizeLogs(`error ${config.SERVICE_KEY} ${config.DB_PASSWORD} private body\nwarning token=private\nready`);
  assert.deepEqual(result, { lines: 3, errors: 1, warnings: 1 });
  assert.equal(summarizeLogs('error\n'.repeat(101)).lines, 100);
});
test('Redis authentication and bounded local logs are explicit', async () => {
  const config = createConfig('taibu-local', 3080);
  assert.match(config.REDIS_PASSWORD, /^[a-f0-9]{64}$/);
  assert.notEqual(config.REDIS_PASSWORD, config.DB_PASSWORD);
  const compose = await readFile(new URL('../../docker-compose.local.yml', import.meta.url), 'utf8');
  assert.match(compose, /REDIS_URL: redis:\/\/:\$\{REDIS_PASSWORD:\?\}@redis:6379/);
  assert.match(compose, /--requirepass/);
  assert.match(compose, /max-size: 10m, max-file: "3"/);
  assert.match(compose, /io\.taibu\.local\.instance/);
  assert.equal((compose.match(/driver: none/g) ?? []).length, 1); // Private sidecar tool output only.
});

test('Storage migration privileges are revoked on success and all failure paths', async () => {
  for (const failure of [null, 'grant', 'migration']) {
    const events = [];
    const operation = withStorageMigrationPrivilege(async statement => {
      const action = statement.startsWith('GRANT') ? 'grant' : 'revoke';
      events.push(action);
      if (failure === action) throw new Error('simulated');
    }, async () => {
      events.push('migration');
      if (failure === 'migration') throw new Error('simulated');
    });
    if (failure) await assert.rejects(operation);
    else await operation;
    assert.equal(events.at(-1), 'revoke');
    assert.deepEqual(events, failure === 'grant' ? ['grant', 'revoke'] : ['grant', 'migration', 'revoke']);
  }
});
test('Storage role installation is disabled and revoke failures fail closed', async () => {
  const compose = await readFile(new URL('../../docker-compose.local.yml', import.meta.url), 'utf8');
  assert.match(compose, /DB_INSTALL_ROLES: 'false'/);
  await assert.rejects(withStorageMigrationPrivilege(async statement => {
    if (statement.startsWith('REVOKE')) throw new Error('simulated revoke failure');
  }, async () => {}));
});

test('GNU LongLink safely roundtrips long Storage directories and filenames', () => {
  const directory = './' + 'a'.repeat(98) + '/';
  const filename = directory + 'b'.repeat(32) + '.png';
  assert.equal(Buffer.byteLength(directory), 101);
  assert.equal(Buffer.byteLength(filename), 137);
  validateStorageArchive(packed(longEntry(directory, '5'), longEntry(filename, '0', 'avatar bytes')));
  validateStorageArchive(packed(longEntry('./' + '字'.repeat(60) + '.png', '0', 'unicode')));
});
test('GNU LongLink rejects malicious paths, links, metadata and pending names', () => {
  for (const name of ['../' + 'x'.repeat(120), './' + 'x'.repeat(120) + '/../escape', '/' + 'x'.repeat(120), './' + 'x'.repeat(120) + String.fromCharCode(92) + 'escape', './safe' + String.fromCharCode(0) + 'hidden']) {
    assert.throws(() => validateStorageArchive(packed(longEntry(name))));
  }
  for (const type of ['1', '2', '3', '4', '6', 'K', 'x', 'g']) assert.throws(() => validateStorageArchive(packed(longEntry('./' + 'x'.repeat(130), type))));
  const pending = tarEntry('././@LongLink', 'L', Buffer.concat([Buffer.from('./pending'), Buffer.from([0])]));
  assert.throws(() => validateStorageArchive(packed(pending)));
  assert.throws(() => validateStorageArchive(packed(pending, pending, tarEntry('./file'))));
  assert.throws(() => validateStorageArchive(packed(tarEntry('././@LongLink', 'L', Buffer.from('./unterminated')), tarEntry('./file'))));
  assert.throws(() => validateStorageArchive(packed(tarEntry('././@LongLink', 'L', Buffer.from([46, 47, 0xff, 0])), tarEntry('./file'))));
});
test('tar rejects bad checksums, incomplete terminators and hidden trailing data', () => {
  const damaged = tarEntry('./file'); damaged[0] ^= 1;
  assert.throws(() => validateStorageArchive(packed(damaged)));
  assert.throws(() => validateStorageArchive(gzipSync(Buffer.concat([tarEntry('./file'), Buffer.alloc(512)]))));
  assert.throws(() => validateStorageArchive(gzipSync(Buffer.concat([tarEntry('./file'), Buffer.alloc(1024), tarEntry('./hidden'), Buffer.alloc(1024)]))));
  assert.throws(() => validateStorageArchive(gzipSync(Buffer.alloc(0))));
});

test('Storage attributes reject unsafe paths, unknown keys, invalid base64 and missing object metadata', () => {
  const attributes = Object.fromEntries(storageAttributes.KEYS.map(key => [key, Buffer.from('value').toString('base64')]));
  const document = entry => Buffer.from(JSON.stringify({ version: 1, entries: [entry] }));
  const entry = { path: 'tenant/object', kind: 'file', attributes };
  storageAttributes.validateAttributes(document(entry));
  for (const unsafe of ['/etc/passwd', '../outside', 'a/../b', 'a//b', 'a/./b', 'a' + String.fromCharCode(92) + 'b', 'a' + String.fromCharCode(0)]) {
    assert.throws(() => storageAttributes.validateAttributes(document({ ...entry, path: unsafe })));
  }
  for (const invalid of [{}, { ...attributes, 'user.supabase.unknown': 'eA==' }, { ...attributes, [storageAttributes.KEYS[0]]: '***' }, { ...attributes, [storageAttributes.KEYS[0]]: Buffer.alloc(4097).toString('base64') }]) {
    assert.throws(() => storageAttributes.validateAttributes(document({ ...entry, attributes: invalid })));
  }
  assert.throws(() => storageAttributes.validateAttributes(Buffer.from(JSON.stringify({ version: 1, entries: [entry, entry] }))));
  assert.throws(() => storageAttributes.validateAttributes(Buffer.alloc(storageAttributes.MAX_BYTES + 1)));
});
test('Storage attribute sidecar roundtrips files and rejects symlinks or incomplete target trees', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'taibu-xattr-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); const target = path.join(root, 'target');
  for (const directory of [source, target]) {
    await mkdir(path.join(directory, 'tenant'), { recursive: true });
    await writeFile(path.join(directory, 'tenant', 'avatar.png'), 'synthetic-avatar');
  }
  const values = new Map(); let writes = 0;
  const xattr = {
    async get(file, key) {
      const value = values.get(`${file}:${key}`);
      if (!value) throw Object.assign(new Error('missing'), { code: 'ENODATA' });
      return value;
    },
    async set(file, key, value) { writes++; values.set(`${file}:${key}`, Buffer.from(value)); },
  };
  await assert.rejects(storageAttributes.capture(source, xattr)); // Missing metadata is never silently dropped.
  const sourceFile = path.join(source, 'tenant', 'avatar.png');
  const targetFile = path.join(target, 'tenant', 'avatar.png');
  values.set(`${sourceFile}:${storageAttributes.KEYS[0]}`, Buffer.from('max-age=3600'));
  values.set(`${sourceFile}:${storageAttributes.KEYS[1]}`, Buffer.from('image/png'));
  const sidecar = await storageAttributes.capture(source, xattr);
  await storageAttributes.restore(target, sidecar, xattr);
  for (const key of storageAttributes.KEYS) assert.deepEqual(values.get(`${targetFile}:${key}`), values.get(`${sourceFile}:${key}`));
  await writeFile(path.join(target, 'unexpected'), 'unexpected');
  const before = writes;
  await assert.rejects(storageAttributes.restore(target, sidecar, xattr));
  assert.equal(writes, before); // Complete preflight precedes writes.
  await symlink(sourceFile, path.join(source, 'symlink'));
  await assert.rejects(storageAttributes.capture(source, xattr));
});
test('backup v2 requires a checksummed sidecar and isolated no-secret attribute helper', async () => {
  const source = await readFile(new URL('../selfhost.mjs', import.meta.url), 'utf8');
  assert.match(source, /version: 2, sourceProject/);
  assert.match(source, /manifest\.version !== 2/);
  assert.match(source, /'storage-attributes\.json': digest\(attributes\)/);
  assert.match(source, /storageAttributes\.validateAttributes\(files\['storage-attributes\.json'\]\)/);
  const compose = await readFile(new URL('../../docker-compose.local.yml', import.meta.url), 'utf8');
  const tool = compose.split('  maintenance-attributes:')[1].split('\nvolumes:')[0];
  assert.match(tool, /image: supabase\/storage-api:v1\.33\.0/);
  assert.match(tool, /network_mode: none/);
  assert.match(tool, /profiles: \[tools\]/);
  assert.doesNotMatch(tool, /environment:|env_file:|SUPABASE_SECRET|PASSWORD|\.env/);
});
