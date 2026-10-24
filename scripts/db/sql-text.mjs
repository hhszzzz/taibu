// Lexical helpers for the maintained SQL files: statement boundaries,
// comparison text and identifiers. Quoted text is never rewritten.
const IDENTIFIER_CHARACTER = /[\p{L}\p{N}_$]/u;
const DOLLAR_TAG = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u;

function scan(sql, onToken) {
  const { length } = sql;
  let index = 0;
  while (index < length) {
    const character = sql[index];
    const next = sql[index + 1];
    let end = index + 1;
    let kind = /\s/u.test(character) ? 'space' : character === ';' ? 'semicolon' : 'code';
    if (character === '-' && next === '-') {
      const newline = sql.indexOf('\n', index);
      end = newline === -1 ? length : newline;
      kind = 'comment';
    } else if (character === '/' && next === '*') {
      let depth = 1;
      end = index + 2;
      while (depth) {
        if (end >= length) throw new Error('unterminated block comment');
        if (sql.startsWith('/*', end)) { depth += 1; end += 2; }
        else if (sql.startsWith('*/', end)) { depth -= 1; end += 2; }
        else end += 1;
      }
      kind = 'comment';
    } else if (character === "'" || character === '"') {
      // E'' strings are the only form where a backslash escapes the quote.
      const backslashes = character === "'" && /[Ee]/u.test(sql[index - 1] ?? '')
        && !IDENTIFIER_CHARACTER.test(sql[index - 2] ?? '');
      for (;;) {
        if (end >= length) throw new Error(`unterminated ${character === '"' ? 'quoted identifier' : 'string literal'}`);
        if (backslashes && sql[end] === '\\') { end += 2; continue; }
        if (sql[end] === character) {
          if (sql[end + 1] !== character) { end += 1; break; }
          end += 2;
          continue;
        }
        end += 1;
      }
      kind = 'quoted';
    } else if (character === '$' && !IDENTIFIER_CHARACTER.test(sql[index - 1] ?? '')) {
      const tag = DOLLAR_TAG.exec(sql.slice(index, index + 64))?.[0];
      if (tag) {
        const close = sql.indexOf(tag, index + tag.length);
        if (close === -1) throw new Error(`unterminated dollar-quoted string ${tag}`);
        end = close + tag.length;
        kind = 'quoted';
      }
    }
    onToken(kind, index, end);
    index = end;
  }
}

/** Top-level statements without their terminating semicolon. */
export function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let pending = false;
  scan(sql, (kind, from, to) => {
    if (kind === 'semicolon') {
      if (pending) statements.push(sql.slice(start, from).trim());
      start = to;
      pending = false;
    } else if (kind === 'code' || kind === 'quoted') {
      pending = true;
    }
  });
  if (pending) throw new Error(`SQL ends without a semicolon: ${sql.slice(start).trim().slice(0, 80)}`);
  return statements;
}

/**
 * Comparison text: comments dropped and whitespace outside quoted text
 * collapsed, so a declaration matches PostgreSQL's own deparsed form.
 */
export function normalizeStatement(text) {
  let output = '';
  let space = false;
  scan(text, (kind, from, to) => {
    if (kind === 'comment' || kind === 'space') {
      space = output.length > 0;
      return;
    }
    if (kind === 'semicolon' && to === text.length) return;
    if (space) output += ' ';
    space = false;
    output += text.slice(from, to);
  });
  return output;
}

/** Splits a list at top-level commas, outside parentheses and quoted text. */
export function splitList(text) {
  const items = [];
  let depth = 0;
  let start = 0;
  scan(text, (kind, from) => {
    if (kind !== 'code') return;
    const character = text[from];
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (character === ',' && depth === 0) {
      items.push(text.slice(start, from).trim());
      start = from + 1;
    }
  });
  const last = text.slice(start).trim();
  if (last) items.push(last);
  return items;
}

/** Index just past the parenthesis that closes the one at `open`. */
export function closingParenthesis(text, open) {
  let depth = 0;
  let close = -1;
  scan(text.slice(open), (kind, from) => {
    if (close !== -1 || kind !== 'code') return;
    const character = text[open + from];
    if (character === '(') depth += 1;
    else if (character === ')' && --depth === 0) close = open + from + 1;
  });
  if (close === -1) throw new Error(`unbalanced parentheses: ${text.slice(open, open + 80)}`);
  return close;
}

export const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)`;
export const QUALIFIED = String.raw`${IDENTIFIER}\.${IDENTIFIER}`;

export function unquoteIdentifier(identifier) {
  return identifier.startsWith('"') ? identifier.slice(1, -1).replaceAll('""', '"') : identifier;
}

/** `schema.name` with each part unquoted; the key format used throughout. */
export function qualifiedName(text) {
  const match = new RegExp(`^(${IDENTIFIER})\\.(${IDENTIFIER})$`, 'u').exec(text);
  if (!match) throw new Error(`expected a schema-qualified name, got ${text}`);
  return `${unquoteIdentifier(match[1])}.${unquoteIdentifier(match[2])}`;
}
