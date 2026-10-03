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

function runBoundaryFixture(t, files) {
  const fixture = mkdtempSync(path.join(tmpdir(), 'taibu-guard-graph-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(fixture, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  const result = spawnSync(process.execPath, [GUARD_SCRIPT], {
    cwd: fixture,
    env: { ...process.env, NODE_OPTIONS: '' },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, 'incomplete fixtures must still fail old required-input guards');
  assert.match(result.stderr, /required architecture input is missing/u);
  assert.doesNotMatch(result.stderr, /ENOENT|RangeError|TypeError/u);
  return result.stderr.split('\n').filter(line => line.includes('dependency path:')).join('\n');
}

const ENTRY = 'src/lib/server/chat/use-case.ts';
const GRAPH_CASES = [
  ['bare Node filesystem builtin', { [ENTRY]: "import { readFileSync } from 'fs';" }, 'fs (forbidden framework/SDK dependency)'],
  ['bare Node network builtin', { [ENTRY]: "const http = require('http');" }, 'http (forbidden framework/SDK dependency)'],
  ['Node builtin subpath', { [ENTRY]: "import { readFile } from 'fs/promises';" }, 'fs/promises (forbidden framework/SDK dependency)'],
  ['prefixed Node builtin', { [ENTRY]: "import { request } from 'node:http';" }, 'node:http (forbidden framework/SDK dependency)'],
  ['AI runtime SDK', { [ENTRY]: "import { streamText } from 'ai';" }, 'ai (forbidden framework/SDK dependency)'],
  ['AI provider SDK', { [ENTRY]: "import { openai } from '@ai-sdk/openai';" }, '@ai-sdk/openai (forbidden framework/SDK dependency)'],
  ['direct framework', { [ENTRY]: "import { headers } from 'next/headers';" }, 'next/headers'],
  ['relative indirect network', {
    [ENTRY]: "import './helper.js';",
    'src/lib/server/chat/helper.ts': "import '@/lib/graph/network';",
    'src/lib/graph/network.ts': "export const load = () => fetch('/api');",
  }, 'src/lib/server/chat/helper.ts -> src/lib/graph/network.ts'],
  ['barrel and index resolution', {
    [ENTRY]: "import '@/lib/graph';",
    'src/lib/graph/index.ts': "export * from './bridge';",
    'src/lib/graph/bridge.ts': "export { createClient } from '@supabase/supabase-js';",
  }, 'src/lib/graph/index.ts -> src/lib/graph/bridge.ts -> @supabase/supabase-js'],
  ['new nested server module', {
    'src/lib/server/new-use-case/prepare.ts': "import 'react';",
  }, 'src/lib/server/new-use-case/prepare.ts -> react'],
  ['new knowledge module', {
    'src/lib/knowledge-base/new-operation.ts': "const value = process.env.KEY;",
  }, 'global environment dependency'],
  ['new server suffix is not an exemption', {
    'src/lib/server/new-adapter.server.ts': "import 'next/server';",
  }, 'new-adapter.server.ts -> next/server'],
  ['literal dynamic import', {
    [ENTRY]: "const load = () => import(`@/lib/graph/lazy`);",
    'src/lib/graph/lazy.ts': "import 'react';",
  }, 'src/lib/graph/lazy.ts -> react'],
  ['literal require', {
    [ENTRY]: "const load = require('@/lib/graph/lazy');",
    'src/lib/graph/lazy.ts': "import 'server-only';",
  }, 'src/lib/graph/lazy.ts -> server-only'],
  ['import equals', { [ENTRY]: "import adapter = require('next/server');" }, 'next/server'],
  ['import type expression', {
    [ENTRY]: "export type DTO = import('@/lib/graph/dto').DTO;",
    'src/lib/graph/dto.ts': "export type DTO = import('@supabase/supabase-js').User;",
  }, 'src/lib/graph/dto.ts -> @supabase/supabase-js'],
  ['type-only re-export', {
    [ENTRY]: "import type { DTO } from '@/lib/graph/barrel';",
    'src/lib/graph/barrel.ts': "export type { User as DTO } from '@supabase/supabase-js';",
  }, '@supabase/supabase-js'],
  ['local type export alias', {
    [ENTRY]: "import type { DTO } from '@/lib/graph/dto';",
    'src/lib/graph/dto.ts': "import type { User as Internal } from '@supabase/supabase-js'; export type { Internal as DTO };",
  }, '@supabase/supabase-js'],
  ['default DTO', {
    [ENTRY]: "import type DTO from '@/lib/graph/dto';",
    'src/lib/graph/dto.ts': "import type { User } from '@supabase/supabase-js'; export default interface DTO { user: User }",
  }, '@supabase/supabase-js'],
  ['type namespace barrel', {
    [ENTRY]: "import type { DTO } from '@/lib/graph/barrel';",
    'src/lib/graph/barrel.ts': "export type * as DTO from './dto';",
    'src/lib/graph/dto.ts': "export type { User } from '@supabase/supabase-js';",
  }, '@supabase/supabase-js'],
  ['DTO entry indirect SDK', {
    'src/lib/data-sources/types.ts': "export type { User } from '@/lib/graph/dto';",
    'src/lib/graph/dto.ts': "export type { User } from '@supabase/supabase-js';",
  }, 'browser-safe data contracts'],
  ['cycle with forbidden exit', {
    [ENTRY]: "import '@/lib/graph/a';",
    'src/lib/graph/a.ts': "export * from './b';",
    'src/lib/graph/b.ts': "export * from './a'; import 'next/server';",
  }, 'src/lib/graph/a.ts -> src/lib/graph/b.ts -> next/server'],
  ['type visit does not hide later runtime visit', {
    [ENTRY]: "import type { DTO } from '@/lib/graph/mixed'; import '@/lib/graph/mixed';",
    'src/lib/graph/mixed.ts': "export type DTO = { id: string }; export const load = () => fetch('/api');",
  }, 'forbidden infrastructure identifier fetch'],
  ['type-only DTO field dependency', {
    [ENTRY]: "import type { DTO } from '@/lib/graph/dto';",
    'src/lib/graph/dto.ts': "import type { User as Account } from '@supabase/supabase-js'; type Nested = { account: Account }; export interface DTO { nested: Nested }",
  }, '@supabase/supabase-js'],
  ['missing relative edge', { [ENTRY]: "export * from './missing';" }, 'unresolved local dependency'],
  ['missing alias edge', { [ENTRY]: "import type { DTO } from '@/lib/missing';" }, 'unresolved local dependency'],
  ['adapter exception is not a traversal exemption', {
    [ENTRY]: "import './bootstrap';",
    'src/lib/server/chat/bootstrap.ts': "export const adapter = 1;",
  }, 'infrastructure adapter dependency'],
  ['custom tsconfig alias', {
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '#graph/*': ['src/lib/graph/*'] } } }),
    [ENTRY]: "import '#graph/helper';",
    'src/lib/graph/helper.ts': "import 'react';",
  }, 'src/lib/graph/helper.ts -> react'],
];
for (const [name, files, diagnostic] of GRAPH_CASES) {
  test(`dependency graph rejects ${name}`, t => {
    const failures = runBoundaryFixture(t, files);
    assert.ok(failures.includes(diagnostic), failures);
  });
}

test('dependency graph accepts pure DTOs, cycles and unreferenced legacy adapters', t => {
  const failures = runBoundaryFixture(t, {
    [ENTRY]: "import type { DTO } from '@/lib/graph/barrel'; import './cycle'; export type Result = DTO;",
    'src/lib/server/chat/cycle.ts': "export * from './use-case'; export const value = 1;",
    'src/lib/graph/barrel.ts': "export type { DTO } from './dto';",
    'src/lib/graph/dto.ts': "export interface DTO { id: string; value: Nested } type Nested = { ok: boolean };",
    'src/lib/server/chat/bootstrap.ts': "import 'server-only'; import type { User } from '@supabase/supabase-js';",
    'src/lib/knowledge-base/persistence.server.ts': "import { createClient } from '@supabase/supabase-js';",
  });
  assert.equal(failures, '');
});

test('type-only DTO selection excludes unrelated runtime imports but follows selected fields', t => {
  const failures = runBoundaryFixture(t, {
    [ENTRY]: "import { type DTO } from '@/lib/graph/mixed'; export type Output = DTO;",
    'src/lib/graph/mixed.ts': "import { useState } from 'react'; export type DTO = { id: string }; export function component() { return useState(1); }",
  });
  assert.equal(failures, '');
});

test('comments and ordinary strings are not dependency edges', t => {
  assert.equal(runBoundaryFixture(t, {
    [ENTRY]: "// import 'next/server'; fetch process.env\nexport const text = \"require('@supabase/supabase-js')\";",
  }), '');
});

test('complete repository retains all architecture guards', () => {
  const result = spawnSync(process.execPath, [GUARD_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_OPTIONS: '' },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Architecture guards passed/u);
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
