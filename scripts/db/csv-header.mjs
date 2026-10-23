import { openSync, readSync, closeSync } from 'node:fs';

/** Read only a bounded header, irrespective of the exported table's size. */
export function csvHeader(file) {
  const fd = openSync(file, 'r');
  let header = Buffer.alloc(0);
  try {
    const buffer = Buffer.alloc(4096);
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      const newline = buffer.subarray(0, count).indexOf(10);
      header = Buffer.concat([header, buffer.subarray(0, newline < 0 ? count : newline)]);
      if (header.length > 1024 * 1024) throw new Error('CSV header exceeds 1 MiB');
      if (newline >= 0 || count === 0) break;
    }
  } finally { closeSync(fd); }
  const line = header.toString('utf8').replace(/\r$/u, '');
  const fields = [];
  let current = '', quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { fields.push(current); current = ''; }
    else current += char;
  }
  fields.push(current);
  return fields.map(field => field.replace(/^\uFEFF/u, '').trim());
}
