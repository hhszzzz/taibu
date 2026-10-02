import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTH_SQL_SOURCE_MANIFEST, SQL_SOURCE_MANIFEST } from './postgres-fixture.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'scripts/check-architecture-guards.mjs');

function checkIgnored(paths) {
  return spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input: `${paths.join('\n')}\n`,
  });
}

test('architecture migration inputs exist and are not hidden by ignore rules', () => {
  const source = readFileSync(GUARD_SCRIPT, 'utf8');
  const paths = [...new Set(
    [...source.matchAll(/['"](supabase\/migrations\/[^'"]+\.sql)['"]/gu)]
      .map((match) => match[1]),
  )];
  assert.ok(paths.length > 0, 'guard migration references must be discovered');
  for (const relativePath of paths) {
    assert.ok(existsSync(path.join(REPO_ROOT, relativePath)), `Missing ${relativePath}`);
  }

  const ignored = checkIgnored(paths);
  assert.equal(ignored.status, 1, ignored.error?.message || ignored.stderr || ignored.stdout);
  assert.equal(ignored.stdout, '');
});

test('PostgreSQL and real Auth fixture source manifests are complete and reproducible', () => {
  const paths = [...Object.values(SQL_SOURCE_MANIFEST), ...Object.values(AUTH_SQL_SOURCE_MANIFEST)];
  assert.equal(new Set(paths).size, paths.length);
  for (const relativePath of paths) {
    assert.ok(existsSync(path.join(REPO_ROOT, relativePath)), `Missing ${relativePath}`);
  }
  const ignored = checkIgnored(paths);
  assert.equal(ignored.status, 1, ignored.error?.message || ignored.stderr || ignored.stdout);
  assert.equal(ignored.stdout, '');
});

test('unreviewed local migrations stay excluded from the repository baseline', () => {
  const relativePath = 'supabase/migrations/unreviewed_local_only.sql';
  const ignored = checkIgnored([relativePath]);
  assert.equal(ignored.status, 0, ignored.error?.message || ignored.stderr);
  assert.equal(ignored.stdout.trim(), relativePath);
});

test('extracted use-case and browser DTO dependencies fail closed', (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'taibu-guard-boundaries-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const cases = [
    ['src/lib/server/analysis.ts', "import type { NextRequest } from 'next/server';"],
    ['src/lib/server/chat/use-case.ts', "const client = require('@/lib/api-utils');"],
    ['src/lib/data-sources/types.ts', "import type { SupabaseClient } from '@supabase/supabase-js';"],
    ['src/lib/knowledge-base/search.ts', 'getSystemAdminClient();'],
  ];
  for (const [relativePath, source] of cases) {
    const target = path.join(fixture, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  const result = spawnSync(process.execPath, [GUARD_SCRIPT], {
    cwd: fixture,
    env: { ...process.env, NODE_OPTIONS: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.error?.message || result.stderr);
  for (const [relativePath] of cases) {
    const failure = result.stderr.split('\n').find(line => line.startsWith(`- ${relativePath}:`));
    assert.ok(failure, `Missing boundary diagnostic for ${relativePath}`);
    assert.doesNotMatch(failure, /input is missing/);
  }
  assert.match(result.stderr, /extracted use cases must keep HTTP/);
  assert.match(result.stderr, /browser-safe data contracts/);
  assert.match(result.stderr, /knowledge search must retain the caller identity/);
});

test('missing architecture inputs fail with actionable diagnostics, not an uncaught ENOENT', (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'taibu-guards-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [GUARD_SCRIPT], {
    cwd: fixture,
    env: { ...process.env, NODE_OPTIONS: '' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1, result.error?.message || result.stderr);
  assert.match(result.stderr, /Architecture guard failures:/u);
  assert.match(result.stderr, /required architecture input is missing/u);
  assert.match(result.stderr, /supabase\/migrations\/20260410_103000_fix_linuxdo_claim_concurrency\.sql/u);
  assert.doesNotMatch(result.stderr, /ENOENT|Error:|\bat readFileSync\b/u);
  assert.doesNotMatch(result.stdout, /Architecture guards passed/u);
});
