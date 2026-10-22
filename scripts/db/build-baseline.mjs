#!/usr/bin/env node
// Builds database/migrations/0002_app_baseline.sql from a pg_dump --schema-only
// of the legacy Supabase `public` schema (the transit database). The output is
// deterministic: identical input bytes always produce identical output bytes.
//
// Applies the T1-T8 transforms from the migration plan. Every transform asserts
// its expected hit count so an unexpected dump shape fails the build instead of
// silently producing a wrong baseline.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

const sourcePath = argValue('--source');
if (!sourcePath) {
  console.error('[db:baseline] --source <transit dump.sql> is required');
  process.exit(1);
}
const outputPath = argValue('--output', path.join(root, 'database/migrations/0002_app_baseline.sql'));
const dryRun = process.argv.includes('--dry-run');

const dump = readFileSync(path.resolve(sourcePath), 'utf8');

// ---------------------------------------------------------------------------
// Object sets removed from the baseline (T2, T4, T6, T7).
// ---------------------------------------------------------------------------
const dropFunctions = new Set([
  'handle_auth_user_profile_sync',       // T2: auth.users trigger helper
  'check_login_attempts',                // T4: login lock moved to Redis
  'record_login_attempt',                // T4
  'consume_rate_limit_slot_as_admin',    // T4: rate limits moved to Redis
  'get_vector_index_dimensions',         // T6: Edge function helper
  'configure_agent_attachment_storage',  // T7: Supabase Storage helper
]);
const dropTables = new Set(['login_attempts', 'rate_limits']);
const dropSequences = new Set(['rate_limits_id_seq']);

const TABLE_REFERENCE = /\b(?:public\.)?(login_attempts|rate_limits)\b/u;

// ---------------------------------------------------------------------------
// Parse the dump into pg_dump's `-- Name: ...; Type: ...` blocks.
// ---------------------------------------------------------------------------
const HEADER = /^--\n-- Name: (.*?); Type: (.*?); Schema: (.*?); Owner: .*?\n--\n\n/gm;
const matches = [...dump.matchAll(HEADER)];
if (matches.length === 0) throw new Error('No pg_dump object blocks found');

const preamble = dump.slice(0, matches[0].index);
if (!preamble.includes('\\restrict')) {
  throw new Error('Expected a pg_dump preamble with \\restrict');
}

const blocks = matches.map((match, index) => {
  const body = dump.slice(match.index + match[0].length, matches[index + 1]?.index ?? dump.length);
  return {
    name: match[1],
    type: match[2],
    schema: match[3],
    body: body.replace(/^\\(?:un)?restrict .*$/gmu, '').replace(/\s+$/u, ''),
  };
});

// ---------------------------------------------------------------------------
// Filter and transform.
// ---------------------------------------------------------------------------
const stats = {
  authFks: 0,
  usersFk: 0,
  adminEmailFunction: 0,
  droppedBlocks: 0,
};
const droppedByType = {};
const kept = [];

function aclObject(name) {
  const space = name.indexOf(' ');
  return space === -1 ? { kind: name, object: '' } : { kind: name.slice(0, space), object: name.slice(space + 1) };
}

function functionName(name) {
  const paren = name.indexOf('(');
  return paren === -1 ? name : name.slice(0, paren);
}

for (const block of blocks) {
  const { name, type, body } = block;

  if (type === 'SCHEMA' && block.schema === '-') {
    stats.droppedBlocks += 1;
    droppedByType[type] = (droppedByType[type] ?? 0) + 1;
    if (process.env.DEBUG_BASELINE) console.log(`drop ${type} ${name}`);
    continue; // public already exists in the managed database
  }

  if (type === 'FUNCTION' && dropFunctions.has(functionName(name))) {
    stats.droppedBlocks += 1;
    droppedByType[type] = (droppedByType[type] ?? 0) + 1;
    if (process.env.DEBUG_BASELINE) console.log(`drop ${type} ${name}`);
    continue;
  }
  if (type === 'TABLE' && dropTables.has(name)) {
    stats.droppedBlocks += 1;
    droppedByType[type] = (droppedByType[type] ?? 0) + 1;
    if (process.env.DEBUG_BASELINE) console.log(`drop ${type} ${name}`);
    continue;
  }
  if ((type === 'SEQUENCE' || type === 'SEQUENCE OWNED BY') && dropSequences.has(name)) {
    stats.droppedBlocks += 1;
    droppedByType[type] = (droppedByType[type] ?? 0) + 1;
    if (process.env.DEBUG_BASELINE) console.log(`drop ${type} ${name}`);
    continue;
  }
  if (type === 'DEFAULT' && dropTables.has(name.split(' ')[0])) {
    stats.droppedBlocks += 1;
    droppedByType[type] = (droppedByType[type] ?? 0) + 1;
    if (process.env.DEBUG_BASELINE) console.log(`drop ${type} ${name}`);
    continue;
  }
  if (type === 'ACL') {
    const { kind, object } = aclObject(name);
    if (
      (kind === 'FUNCTION' && dropFunctions.has(functionName(object)))
      || (kind === 'TABLE' && dropTables.has(object))
      || (kind === 'SEQUENCE' && dropSequences.has(object))
    ) {
      stats.droppedBlocks += 1;
      const dropKey = `ACL_${kind}`;
      droppedByType[dropKey] = (droppedByType[dropKey] ?? 0) + 1;
      if (process.env.DEBUG_BASELINE) console.log(`drop ${type} ${name}`);
      continue;
    }
  }
  if (['CONSTRAINT', 'FK CONSTRAINT', 'INDEX', 'TRIGGER', 'POLICY', 'ROW SECURITY'].includes(type)
    && TABLE_REFERENCE.test(body)) {
    stats.droppedBlocks += 1;
    droppedByType[type] = (droppedByType[type] ?? 0) + 1;
    if (process.env.DEBUG_BASELINE) console.log(`drop ${type} ${name}`);
    continue;
  }

  if (type === 'FK CONSTRAINT' && body.includes('REFERENCES auth.users(id)')) {
    const constraintName = name.split(' ').pop();
    if (constraintName === 'users_id_fkey') {
      block.body = body.replace(
        'REFERENCES auth.users(id)',
        'REFERENCES identity.users(id) ON DELETE CASCADE',
      );
      stats.usersFk += 1;
    } else {
      block.body = body.replace('REFERENCES auth.users(id)', 'REFERENCES public.users(id)');
      stats.authFks += 1;
    }
  }

  if (type === 'FUNCTION' && functionName(name) === 'admin_get_auth_user_emails') {
    let count = 0;
    block.body = body
      .replace("SET search_path TO 'public', 'auth'", () => {
        count += 1;
        return "SET search_path TO 'public', 'identity'";
      })
      .replace('FROM auth.users au', () => {
        count += 1;
        return 'FROM identity.users au';
      });
    if (count !== 2) throw new Error(`admin_get_auth_user_emails: expected 2 edits, got ${count}`);
    stats.adminEmailFunction += 1;
  }

  kept.push(block);
}

// ---------------------------------------------------------------------------
// Assertions: the dump shape must match what the transforms expect.
// ---------------------------------------------------------------------------
const expected = {
  authFks: 32,
  usersFk: 1,
  adminEmailFunction: 1,
  droppedBlocks: 27,
};
for (const [key, value] of Object.entries(expected)) {
  if (stats[key] !== value) {
    throw new Error(`Transform ${key}: expected ${value}, got ${stats[key]}`);
  }
}
const expectedDrops = {
  SCHEMA: 1,
  FUNCTION: 6,
  FUNCTION_ACL: 6,
  TABLE: 2,
  TABLE_ACL: 2,
  SEQUENCE: 1,
  SEQUENCE_OWNED_BY: 1,
  SEQUENCE_ACL: 1,
  DEFAULT: 1,
  CONSTRAINT: 2,
  POLICY: 2,
  ROW_SECURITY: 2,
};
const actualDrops = {
  SCHEMA: droppedByType.SCHEMA ?? 0,
  FUNCTION: droppedByType.FUNCTION ?? 0,
  FUNCTION_ACL: droppedByType.ACL_FUNCTION ?? 0,
  TABLE: droppedByType.TABLE ?? 0,
  TABLE_ACL: droppedByType.ACL_TABLE ?? 0,
  SEQUENCE: droppedByType.SEQUENCE ?? 0,
  SEQUENCE_OWNED_BY: droppedByType['SEQUENCE OWNED BY'] ?? 0,
  SEQUENCE_ACL: droppedByType.ACL_SEQUENCE ?? 0,
  DEFAULT: droppedByType.DEFAULT ?? 0,
  CONSTRAINT: droppedByType.CONSTRAINT ?? 0,
  POLICY: droppedByType.POLICY ?? 0,
  ROW_SECURITY: droppedByType['ROW SECURITY'] ?? 0,
};
for (const [key, value] of Object.entries(expectedDrops)) {
  if (actualDrops[key] !== value) {
    throw new Error(`Dropped ${key}: expected ${value}, got ${actualDrops[key]}`);
  }
}
if (kept.some((block) => block.body.includes('REFERENCES auth.users'))) {
  throw new Error('Unrepointed auth.users foreign key left in baseline');
}
if (kept.some((block) => block.body.includes('auth.users'))) {
  throw new Error('Unresolved auth.users reference left in baseline');
}

// ---------------------------------------------------------------------------
// Emit.
// ---------------------------------------------------------------------------
const sourceHash = createHash('sha256').update(dump).digest('hex');
const header = [
  '-- Application schema baseline (public schema).',
  '-- Generated by scripts/db/build-baseline.mjs. Do not edit by hand.',
  '--',
  '-- Source: pg_dump --schema-only --schema=public from the transit database,',
  '-- transformed per the migration plan:',
  '--   T1  auth.users foreign keys repointed to public.users (and users.id to',
  '--       identity.users with ON DELETE CASCADE)',
  '--   T2  GoTrue profile-sync trigger helper removed',
  '--   T3  admin_get_auth_user_emails reads identity.users',
  '--   T4  rate_limits/login_attempts tables and their functions removed',
  '--   T6  Edge vector-index helper removed',
  '--   T7  Supabase Storage helper removed',
  `--`,
  `-- source sha256: ${sourceHash}`,
  '',
  'SET LOCAL check_function_bodies = false;',
  '',
  '',
].join('\n');

const output = `${header}${kept.map((block) => [
  '--',
  `-- Name: ${block.name}; Type: ${block.type}; Schema: ${block.schema}; Owner: -`,
  '--',
  '',
  block.body,
  '',
  '',
].join('\n')).join('')}`;

if (dryRun) {
  console.log(`[db:baseline] would write ${path.relative(root, outputPath)}`);
  console.log(`[db:baseline] blocks: ${blocks.length} -> ${kept.length} (dropped ${stats.droppedBlocks})`);
  console.log(`[db:baseline] auth fks: ${stats.authFks}, users fk: ${stats.usersFk}, admin email fn: ${stats.adminEmailFunction}`);
} else {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);
  console.log(`[db:baseline] wrote ${path.relative(root, outputPath)} (${kept.length} blocks)`);
}
