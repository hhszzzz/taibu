// Picks a writable location for generated reports.
//
// Local runs prefer <repo>/tmp (gitignored); one-off containers run as an
// unprivileged user with a read-only /app, so fall back to the OS temp dir.
// TAIBU_REPORT_DIR overrides both.
import { accessSync, constants, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function defaultReportPath(root, prefix, extension = 'json', env = process.env) {
  const candidates = env.TAIBU_REPORT_DIR
    ? [env.TAIBU_REPORT_DIR, tmpdir()]
    : [path.join(root, 'tmp'), tmpdir()];
  for (const directory of candidates) {
    try {
      mkdirSync(directory, { recursive: true });
      accessSync(directory, constants.W_OK);
      return path.join(directory, `${prefix}-${Date.now()}.${extension}`);
    } catch {
      // try the next candidate
    }
  }
  return path.join(tmpdir(), `${prefix}-${Date.now()}.${extension}`);
}
