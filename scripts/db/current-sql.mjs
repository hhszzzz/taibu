// The maintained SQL files, read as declarations: what each file defines and
// the canonical text PostgreSQL deparses for it. Anything a file contains that
// db:init cannot reconcile is rejected instead of being silently ignored.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  IDENTIFIER, QUALIFIED, closingParenthesis, normalizeStatement, qualifiedName, splitList, splitStatements,
  unquoteIdentifier,
} from './sql-text.mjs';

export const DATABASE_SQL_FILES = ['schema', 'functions', 'triggers', 'access', 'seed', 'indexes'];

export async function readDatabaseSql(root) {
  return Object.fromEntries(await Promise.all(DATABASE_SQL_FILES.map(async name =>
    [name, await readFile(path.join(root, 'database', `${name}.sql`), 'utf8')])));
}

function statementsOf(file, sql) {
  return splitStatements(sql).map((text) => ({ file, text, canonical: normalizeStatement(text) }));
}

function unsupported(statement) {
  return new Error(`database/${statement.file}.sql: unsupported statement: ${statement.canonical.slice(0, 120)}`);
}

function matching(pattern, statement) {
  return new RegExp(pattern, 'u').exec(statement.canonical);
}

function optionList(text) {
  return splitList(text).map((option) => {
    const match = /^([a-z_][a-z0-9_.]*)=(?:'((?:[^']|'')*)'|(\S+))$/u.exec(option);
    if (!match) throw new Error(`unsupported storage option: ${option}`);
    return `${match[1]}=${match[2]?.replaceAll("''", "'") ?? match[3]}`;
  }).sort();
}

// Tables are compared by meaning, not position: columns added to an existing
// table land at its end while schema.sql keeps them where they read best.
function parseTables(sql) {
  const tables = new Map();
  const table = (name, statement) => {
    const found = tables.get(name);
    if (!found) throw new Error(`database/schema.sql: ${statement.canonical.slice(0, 80)} precedes CREATE TABLE ${name}`);
    return found;
  };
  const column = (found, name, statement) => {
    const entry = found.columns.find((item) => item.name === name);
    if (!entry) throw new Error(`database/schema.sql: unknown column ${found.name}.${name} in ${statement.canonical.slice(0, 80)}`);
    return entry;
  };
  for (const statement of statementsOf('schema', sql)) {
    const create = matching(`^CREATE TABLE (${QUALIFIED}) \\(`, statement);
    if (create) {
      const name = qualifiedName(create[1]);
      const open = create[0].length - 1;
      const close = closingParenthesis(statement.canonical, open);
      const rest = statement.canonical.slice(close).trim();
      const options = /^WITH \((.*)\)$/u.exec(rest);
      if (rest && !options) throw unsupported(statement);
      const entry = { name, columns: [], constraints: [], options: options ? optionList(options[1]) : [] };
      for (const element of splitList(statement.canonical.slice(open + 1, close - 1))) {
        const constraint = new RegExp(`^CONSTRAINT (${IDENTIFIER}) (.+)$`, 'u').exec(element);
        if (constraint) {
          entry.constraints.push({ name: unquoteIdentifier(constraint[1]), definition: constraint[2] });
          continue;
        }
        const definition = new RegExp(`^(${IDENTIFIER}) (.+)$`, 'u').exec(element);
        if (!definition) throw unsupported(statement);
        entry.columns.push({ name: unquoteIdentifier(definition[1]), definition: definition[2], compression: null, identity: null });
      }
      tables.set(name, entry);
      continue;
    }
    const compression = matching(`^ALTER TABLE ONLY (${QUALIFIED}) ALTER COLUMN (${IDENTIFIER}) SET COMPRESSION ([a-z0-9]+)$`, statement);
    if (compression) {
      const found = table(qualifiedName(compression[1]), statement);
      column(found, unquoteIdentifier(compression[2]), statement).compression = compression[3];
      continue;
    }
    const identity = matching(`^ALTER TABLE (${QUALIFIED}) ALTER COLUMN (${IDENTIFIER}) ADD GENERATED (?:ALWAYS|BY DEFAULT) AS IDENTITY \\(.+\\)$`, statement);
    if (identity) {
      const found = table(qualifiedName(identity[1]), statement);
      column(found, unquoteIdentifier(identity[2]), statement).identity = statement.canonical;
      continue;
    }
    const constraint = matching(`^ALTER TABLE ONLY (${QUALIFIED}) ADD CONSTRAINT (${IDENTIFIER}) (.+)$`, statement);
    if (constraint) {
      table(qualifiedName(constraint[1]), statement).constraints.push({
        name: unquoteIdentifier(constraint[2]), definition: constraint[3],
      });
      continue;
    }
    throw unsupported(statement);
  }
  return [...tables.values()];
}

function parseRoutines(sql) {
  const functions = [];
  const views = [];
  for (const statement of statementsOf('functions', sql)) {
    if (/^CREATE OR REPLACE FUNCTION /u.test(statement.canonical)) {
      functions.push(statement);
      continue;
    }
    const view = matching(`^CREATE OR REPLACE VIEW (${QUALIFIED})(?: WITH \\(.*?\\))? AS `, statement);
    if (!view) throw unsupported(statement);
    views.push({ ...statement, name: qualifiedName(view[1]) });
  }
  return { functions, views };
}

function parseTriggers(sql) {
  return statementsOf('triggers', sql).map((statement) => {
    const trigger = matching(`^CREATE TRIGGER (${IDENTIFIER}) (?:BEFORE|AFTER|INSTEAD OF) .+? ON (${QUALIFIED}) `, statement);
    if (!trigger) throw unsupported(statement);
    return { ...statement, name: unquoteIdentifier(trigger[1]), table: qualifiedName(trigger[2]) };
  });
}

function parseAccess(sql) {
  const access = { rowSecurity: [], policies: [], grants: [] };
  for (const statement of statementsOf('access', sql)) {
    const policy = matching(`^CREATE POLICY (${IDENTIFIER}) ON (${QUALIFIED})(?: |$)`, statement);
    const rowSecurity = matching(`^ALTER TABLE (${QUALIFIED}) ENABLE ROW LEVEL SECURITY$`, statement);
    if (policy) access.policies.push({ ...statement, name: unquoteIdentifier(policy[1]), table: qualifiedName(policy[2]) });
    else if (rowSecurity) access.rowSecurity.push(qualifiedName(rowSecurity[1]));
    // Only grants: db:init revokes every privilege access.sql does not declare.
    else if (/^GRANT /u.test(statement.canonical)) access.grants.push(statement);
    else throw unsupported(statement);
  }
  return access;
}

function parseIndexes(sql) {
  return statementsOf('indexes', sql).map((statement) => {
    const index = matching(`^CREATE (UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS (${IDENTIFIER}) ON (?:ONLY )?(${QUALIFIED}) `, statement);
    if (!index) throw unsupported(statement);
    const table = qualifiedName(index[3]);
    return {
      ...statement,
      name: `${table.split('.')[0]}.${unquoteIdentifier(index[2])}`,
      table,
      // pg_get_indexdef's form: the build options are not part of the index.
      canonical: statement.canonical.replace(/^CREATE (UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS /u, 'CREATE $1INDEX '),
    };
  });
}

function duplicates(items, label, key = (item) => item.name) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) throw new Error(`duplicate ${label} declaration: ${value}`);
    seen.add(value);
  }
}

/** Parses every file; throws on any statement db:init would not reconcile. */
export function parseDatabaseSql(sql) {
  const tables = parseTables(sql.schema);
  const { functions, views } = parseRoutines(sql.functions);
  const triggers = parseTriggers(sql.triggers);
  const access = parseAccess(sql.access);
  const indexes = parseIndexes(sql.indexes);
  if (!tables.length) throw new Error('database/schema.sql has no table definitions');
  duplicates(tables, 'table');
  duplicates(views, 'view');
  duplicates(triggers, 'trigger', (item) => `${item.table}|${item.name}`);
  duplicates(access.policies, 'policy', (item) => `${item.table}|${item.name}`);
  duplicates(access.rowSecurity.map((name) => ({ name })), 'row level security');
  duplicates(indexes, 'index');
  return { sql, tables, functions, views, triggers, ...access, indexes };
}

export async function readDatabaseDefinitions(root) {
  return parseDatabaseSql(await readDatabaseSql(root));
}
