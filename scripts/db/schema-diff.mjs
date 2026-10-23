#!/usr/bin/env node
// Compares the public schema of two databases after normalising pg_dump output.
//
// Used in P5 to adjudicate drift between the transit database (production
// schema + replayed pending migrations) and the legacy self-host stack, and in
// P10 to check that database/schema.sql still matches the migrations.
//
// Usage:
//   node scripts/db/schema-diff.mjs --a <dsn> --b <dsn> [--out tmp/schema.diff]
//   node scripts/db/schema-diff.mjs --a <dsn> --b <dsn> --allow-diff
//
// Exit code is 1 when the schemas differ, so CI can gate on it.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSchemaDump } from './normalize-schema.mjs';
import { defaultReportPath } from './report-path.mjs';
import { libpqEnvironment } from './connection-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PG_DUMP_BIN = process.env.PG_DUMP_BIN || 'pg_dump';
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const aUrl = value('--a', process.env.SCHEMA_DIFF_A);
const bUrl = value('--b', process.env.SCHEMA_DIFF_B);
const outPath = path.resolve(value('--out', defaultReportPath(root, 'schema-diff', 'txt')));
const allowDiff = has('--allow-diff');
const labels = { a: value('--label-a', 'a'), b: value('--label-b', 'b') };

if (!aUrl || !bUrl) {
  console.error('[schema-diff] --a and --b (or SCHEMA_DIFF_A/SCHEMA_DIFF_B) are required');
  process.exit(1);
}


function dumpSchema(dsn) {
  return new Promise((resolve, reject) => {
    const child = spawn(PG_DUMP_BIN, [
      '--schema-only',
      '--schema=public',
      '--no-owner',
      '--no-privileges',
      '--no-comments',
    ], { env: libpqEnvironment(dsn), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`pg_dump failed (${code}): ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

function lineDiff(leftFile, rightFile) {
  return new Promise((resolve) => {
    const child = spawn('diff', ['-u', '--label', labels.a, '--label', labels.b, leftFile, rightFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('close', (code) => resolve({ code, diff: stdout }));
  });
}

async function main() {
  const [aDump, bDump] = await Promise.all([dumpSchema(aUrl), dumpSchema(bUrl)]);
  const a = normalizeSchemaDump(aDump);
  const b = normalizeSchemaDump(bDump);

  if (a === b) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, '');
    console.log('[schema-diff] no differences');
    return 0;
  }

  const directory = mkdtempSync(path.join(tmpdir(), 'taibu-schema-diff-'));
  try {
    const aFile = path.join(directory, 'a.sql');
    const bFile = path.join(directory, 'b.sql');
    writeFileSync(aFile, a);
    writeFileSync(bFile, b);
    const { diff } = await lineDiff(aFile, bFile);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, diff);
    const removed = (diff.match(/^-[^-]/gmu) ?? []).length;
    const added = (diff.match(/^\+[^+]/gmu) ?? []).length;
    console.log(`[schema-diff] ${removed} line(s) only in ${labels.a}, ${added} line(s) only in ${labels.b}`);
    console.log(`[schema-diff] report: ${outPath}`);
    return allowDiff ? 0 : 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`[schema-diff] failed: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 2;
});
