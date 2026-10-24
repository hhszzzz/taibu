#!/usr/bin/env node
// Generates src/lib/db/generated/{schema,rpc}.ts from a live PostgreSQL catalog.
// Source of truth: pg_catalog / information_schema, scope = public schema.
// Usage:
//   DATABASE_URL=... node scripts/db/codegen.mjs
//   node scripts/db/codegen.mjs --project taibu-agent-1006b   (local compose stack)
//   node scripts/db/codegen.mjs --check                      (fail on drift)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(ROOT, 'src', 'lib', 'db', 'generated');

const COLUMNS_SQL = `select coalesce(json_agg(x), '[]')::text from (
  select c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default,
         c.is_identity, c.is_generated, c.ordinal_position
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type in ('BASE TABLE', 'VIEW')
  order by c.table_name, c.ordinal_position
) x;`;

const ENUMS_SQL = `select coalesce(json_agg(x), '[]')::text from (
  select t.typname as name,
         (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) as labels
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'
  order by t.typname
) x;`;

const FUNCTIONS_SQL = `select coalesce(json_agg(x), '[]')::text from (
  select p.proname as name, p.proretset as setof,
         format_type(p.prorettype, null) as rettype,
         coalesce(p.proargnames, '{}') as argnames,
         (select coalesce(array_agg(format_type(a, null) order by ord), '{}')
            from unnest(p.proargtypes::oid[]) with ordinality as u(a, ord)) as argtypes,
         p.pronargdefaults as ndefaults, p.pronargs as nargs,
         pg_get_function_result(p.oid) as result,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  order by p.proname
) x;`;

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function queryViaUrl(url) {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // pg does not support concurrent queries on one client; run them in order.
    const columns = await client.query(COLUMNS_SQL);
    const enums = await client.query(ENUMS_SQL);
    const functions = await client.query(FUNCTIONS_SQL);
    return {
      columns: JSON.parse(columns.rows[0].coalesce),
      enums: JSON.parse(enums.rows[0].coalesce),
      functions: JSON.parse(functions.rows[0].coalesce),
    };
  } finally {
    await client.end();
  }
}

function queryViaLocalStack(project) {
  if (!/^taibu-[a-z0-9][a-z0-9-]{0,39}$/.test(project)) throw new Error('--project 非法');
  const envFile = path.join(ROOT, '.taibu-local', project, 'compose.env');
  if (!existsSync(envFile)) throw new Error(`本地配置不存在：${path.relative(ROOT, envFile)}`);
  const psql = (sql) => execFileSync('docker', [
    'compose', '--project-directory', ROOT, '--env-file', envFile,
    '-f', path.join(ROOT, 'deploy/compose.base.yml'),
    '-f', path.join(ROOT, 'deploy/compose.local.yml'), '-p', project,
    'exec', '-T', 'db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'taibu',
  ], { cwd: ROOT, input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  return {
    columns: JSON.parse(psql(COLUMNS_SQL)),
    enums: JSON.parse(psql(ENUMS_SQL)),
    functions: JSON.parse(psql(FUNCTIONS_SQL)),
  };
}


const SCALARS = {
  int2: 'number', int4: 'number', int8: 'number', float4: 'number', float8: 'number', numeric: 'number',
  bool: 'boolean', text: 'string', varchar: 'string', bpchar: 'string', uuid: 'string', name: 'string',
  date: 'string', timestamptz: 'string', timestamp: 'string', time: 'string', timetz: 'string',
  json: 'Json', jsonb: 'Json', bytea: 'Buffer', vector: 'string', interval: 'string', inet: 'string',
};

const FORMAT_TYPE_SCALARS = {
  'smallint': 'number', 'integer': 'number', 'bigint': 'number', 'real': 'number',
  'double precision': 'number', 'numeric': 'number', 'boolean': 'boolean', 'text': 'string',
  'character varying': 'string', 'character': 'string', 'uuid': 'string',
  'timestamp with time zone': 'string', 'timestamp without time zone': 'string',
  'date': 'string', 'time with time zone': 'string', 'time without time zone': 'string',
  'json': 'Json', 'jsonb': 'Json', 'bytea': 'Buffer', 'interval': 'string',
};

function pascal(name) {
  return name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('');
}

function columnType(column, enums) {
  const nullable = column.is_nullable === 'YES';
  const base = SCALARS[column.udt_name] ?? enums.get(column.udt_name) ?? 'unknown';
  if (column.is_generated === 'ALWAYS') return `GeneratedAlways<${nullable ? `${base} | null` : base}>`;
  if (column.is_identity === 'YES') return 'GeneratedAlways<number>';
  if (column.column_default !== null) return `Generated<${nullable ? `${base} | null` : base}>`;
  if (nullable) return `ColumnType<${base} | null, ${base} | null | undefined, ${base} | null | undefined>`;
  return `ColumnType<${base}, ${base}, ${base}>`;
}

function serializeSchema({ columns, enums: enumRows }) {
  const enums = new Map(enumRows.map((row) => [row.name, row.labels.map((label) => JSON.stringify(label)).join(' | ')]));
  const tables = new Map();
  for (const column of columns) {
    if (!tables.has(column.table_name)) tables.set(column.table_name, []);
    tables.get(column.table_name).push(column);
  }
  const lines = [
    '// Generated by pnpm db:codegen from the public schema catalog. Do not edit.',
    "import type { ColumnType, Generated, GeneratedAlways } from 'kysely';",
    '',
    'export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };',
    '',
  ];
  const interfaceNames = new Map();
  for (const [table, tableColumns] of tables) {
    const interfaceName = pascal(table);
    interfaceNames.set(table, interfaceName);
    lines.push(`export interface ${interfaceName} {`);
    for (const column of tableColumns) lines.push(`  ${column.column_name}: ${columnType(column, enums)};`);
    lines.push('}', '');
  }
  lines.push('export interface DB {');
  for (const [table, interfaceName] of interfaceNames) lines.push(`  ${JSON.stringify(table)}: ${interfaceName};`);
  lines.push('}', '');
  return lines.join('\n');
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function formatTypeToTs(type, enums) {
  const normalized = type.trim();
  if (normalized.endsWith('[]')) return `${formatTypeToTs(normalized.slice(0, -2), enums)}[]`;
  const element = enums.get(normalized.replace(/^public\./, ''));
  if (element) return element;
  return FORMAT_TYPE_SCALARS[normalized] ?? SCALARS[normalized] ?? 'unknown';
}

function resultType(fn, enums) {
  if (fn.rettype === 'void') return 'null';
  const table = /^TABLE\((.*)\)$/s.exec(fn.result.trim());
  let value;
  if (table) {
    const fields = splitTopLevel(table[1]).map((definition) => {
      const match = /^"?([^" ]+)"?\s+(.+)$/s.exec(definition.trim());
      if (!match) throw new Error(`无法解析 ${fn.name} 的 TABLE 列：${definition}`);
      return `${match[1]}: ${formatTypeToTs(match[2], enums)};`;
    });
    value = `{ ${fields.join(' ')} }`;
  } else {
    value = formatTypeToTs(fn.rettype, enums);
    if (value === 'unknown') value = 'Record<string, unknown>';
  }
  return fn.setof ? `${value}[]` : value;
}

function serializeRpc({ functions, enums: enumRows }) {
  const enums = new Map(enumRows.map((row) => [row.name, row.labels.map((label) => JSON.stringify(label)).join(' | ')]));
  const inputs = functions.filter((fn) => fn.auth_exec || fn.anon_exec);
  const byName = new Map();
  for (const fn of inputs) {
    if (byName.has(fn.name)) throw new Error(`RPC ${fn.name} 存在多个可执行重载；请先清理死重载`);
    byName.set(fn.name, fn);
  }
  const lines = [
    '// Generated by pnpm db:codegen from pg_proc. Do not edit.',
    '',
    'export interface RpcRegistry {',
  ];
  for (const fn of byName.values()) {
    const names = fn.argnames.slice(0, fn.nargs);
    const args = fn.argtypes.map((type, index) => {
      const optional = index >= fn.nargs - fn.ndefaults;
      const name = names[index] ?? `arg${index + 1}`;
      // SQL function arguments have no NOT NULL guarantee, and json/jsonb accept
      // any serialisable value, so callers never need a cast at the call site.
      const tsType = type === 'json' || type === 'jsonb' ? 'unknown' : formatTypeToTs(type, enums);
      return `${JSON.stringify(name)}${optional ? '?' : ''}: ${tsType} | null;`;
    });
    const argBody = args.length ? `{ ${args.join(' ')} }` : 'Record<string, never>';
    lines.push(`  ${JSON.stringify(fn.name)}: { args: ${argBody}; result: ${resultType(fn, enums)} };`);
  }
  lines.push('}', '');
  lines.push('export type RpcName = keyof RpcRegistry;');
  lines.push('export type RpcArgs<N extends RpcName> = RpcRegistry[N][\'args\'];');
  lines.push("export type RpcResult<N extends RpcName> = RpcRegistry[N]['result'];", '');
  lines.push("export type RpcReturnShape = 'void' | 'scalar' | 'row' | 'setof';", '');
  lines.push('export const RPC_SPECS = {');
  for (const fn of byName.values()) {
    const names = fn.argnames.slice(0, fn.nargs);
    const args = fn.argtypes.map((type, index) => {
      const optional = index >= fn.nargs - fn.ndefaults;
      const name = names[index] ?? `arg${index + 1}`;
      if (!/^[A-Za-z0-9_ .()[\]"]+$/.test(type)) throw new Error(`RPC 参数类型含非法字符：${type}`);
      return `[${JSON.stringify(name)}, ${JSON.stringify(type)}, ${optional}]`;
    });
    const shape = fn.rettype === 'void' ? 'void'
      : fn.setof ? 'setof'
        : /^TABLE\(/s.test(fn.result.trim()) || formatTypeToTs(fn.rettype, enums) === 'unknown' ? 'row' : 'scalar';
    lines.push(`  ${JSON.stringify(fn.name)}: { args: [${args.join(', ')}], returns: ${JSON.stringify(shape)} },`);
  }
  lines.push('} as const satisfies Record<string, { args: readonly (readonly [string, string, boolean])[]; returns: RpcReturnShape }>;', '');
  const body = lines.join('\n');
  return /\bJson\b/u.test(body) ? `import type { Json } from './schema';\n\n${body}` : body;
}

async function main() {
  const url = argValue('url') ?? process.env.DATABASE_URL;
  const project = argValue('project');
  const check = process.argv.includes('--check');
  if (!url && !project) throw new Error('需要 DATABASE_URL、--url 或 --project');
  const catalog = url ? await queryViaUrl(url) : queryViaLocalStack(project);
  const outputs = {
    'schema.ts': serializeSchema(catalog),
    'rpc.ts': serializeRpc(catalog),
  };
  let drift = false;
  for (const [file, content] of Object.entries(outputs)) {
    const target = path.join(OUT_DIR, file);
    if (check) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== content) {
        console.error(`[db:codegen] ${path.relative(ROOT, target)} 与数据库不一致`);
        drift = true;
      }
      continue;
    }
    writeFileSync(target, content);
    console.log(`[db:codegen] 写入 ${path.relative(ROOT, target)}`);
  }
  if (drift) process.exitCode = 1;
}

await main();
