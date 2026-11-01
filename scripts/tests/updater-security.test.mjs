import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const updateScript = path.join(repoRoot, 'deploy/update.sh');
const logId = '00000000-0000-4000-8000-000000000001';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'taibu-updater-security-'));
  const root = path.join(directory, 'source');
  const runDir = path.join(directory, 'run');
  const binDir = path.join(directory, 'bin');
  const marker = path.join(directory, 'deployed');
  await mkdir(path.join(root, 'deploy'), { recursive: true });
  await mkdir(runDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(root, 'deploy/deploy.sh'), '#!/usr/bin/env bash\ntouch "$TAIBU_MARKER"\n', { mode: 0o755 });
  await writeFile(path.join(binDir, 'docker'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  const log = path.join(directory, 'updater.log');
  await writeFile(path.join(binDir, 'mktemp'), '#!/usr/bin/env bash\n: > "$TAIBU_TEST_LOG"\nprintf "%s\\n" "$TAIBU_TEST_LOG"\n', { mode: 0o755 });
  return { directory, root, runDir, binDir, marker, log };
}

function run(fixture) {
  return spawnSync('bash', [updateScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ROOT: fixture.root,
      ENV_FILE: path.join(fixture.directory, 'compose.env'),
      TAIBU_RUN_DIR: fixture.runDir,
      TAIBU_MARKER: fixture.marker,
      TAIBU_TEST_LOG: fixture.log,
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    },
  });
}

test('host updater refuses a malformed release tag before invoking deploy.sh', async t => {
  const state = await fixture();
  t.after(() => rm(state.directory, { recursive: true, force: true }));
  await writeFile(path.join(state.runDir, 'update-request'), JSON.stringify({ log_id: logId, release_tag: 'not-a-release' }));

  const result = run(state);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /invalid request id or release tag/u);
  await assert.rejects(access(state.marker), { code: 'ENOENT' });
});

test('host updater accepts a well-formed release tag and delegates once', async t => {
  const state = await fixture();
  t.after(() => rm(state.directory, { recursive: true, force: true }));
  await writeFile(path.join(state.runDir, 'update-request'), JSON.stringify({ log_id: logId, release_tag: 'v1.2.3-rc.1+build.7' }));

  const result = run(state);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  await access(state.marker);
  await assert.rejects(access(path.join(state.runDir, 'update-request.handled')), { code: 'ENOENT' });
});
