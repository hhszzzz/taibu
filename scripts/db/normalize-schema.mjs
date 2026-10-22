// Shared pg_dump normaliser for schema-diff and database/schema.sql.
//
// pg_dump output is not stable across server versions and object creation
// order. Keep object bodies, sort objects by name/type and drop the session
// boilerplate that only reflects the dumping client.

export function normalizeSchemaDump(dump) {
  const lines = dump.split('\n').filter((line) => {
    if (line.startsWith('\\restrict') || line.startsWith('\\unrestrict')) return false;
    if (line.startsWith('--') && !line.startsWith('-- Name:')) return false;
    if (/^SET (client_encoding|standard_conforming_strings|search_path)\b/u.test(line)) return false;
    if (/^SELECT pg_catalog\.set_config\(/u.test(line)) return false;
    if (line.trim() === '') return false;
    return true;
  });

  const blocks = [];
  let current = null;
  for (const line of lines) {
    const header = line.match(/^-- Name: (.*?); Type: (.*?); Schema: /u);
    if (header) {
      if (current) blocks.push(current);
      current = { key: `${header[2]}\u0000${header[1]}`, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  blocks.sort((left, right) => left.key.localeCompare(right.key));
  return `${blocks.map((block) => block.lines.join('\n')).join('\n\n')}\n`;
}
