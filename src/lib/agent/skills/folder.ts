/**
 * Reads files the user picked in the browser into what a skill keeps: SKILL.md and the text files beside it. A picked
 * folder keeps its layout; the shallowest SKILL.md marks the skill's directory, as pi finds a skill on disk.
 */
import { SKILL_DOCUMENT, SKILL_FILE_MAX_BYTES, SKILL_FILES_MAX, skillPathProblem } from './config';

export type PickedSkillFile = { path: string; content: string; bytes: number };
export type PickedSkill = {
  /** SKILL.md, when the folder had one. */
  content: string | null;
  files: PickedSkillFile[];
  /** Files left out, each with why. */
  skipped: string[];
};

/** Hidden files and caches never belong to a skill. */
const IGNORED = /(^|\/)(\.[^/]*|__pycache__|node_modules)(\/|$)/u;

/** The text of a file, or null for one that is not UTF-8 text. */
async function text(file: File): Promise<string | null> {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    return decoded.includes('\u0000') ? null : decoded;
  } catch {
    return null;
  }
}

/** `files` from a folder picker carry their path inside the picked folder; single files have only their name. */
export async function readPickedSkill(files: readonly File[]): Promise<PickedSkill> {
  const entries = files.map(file => ({ file, path: (file.webkitRelativePath || file.name).replace(/^\/+/u, '') }));
  const documents = entries.filter(entry => entry.path === SKILL_DOCUMENT || entry.path.endsWith(`/${SKILL_DOCUMENT}`))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const root = documents.length ? documents[0].path.slice(0, -SKILL_DOCUMENT.length) : '';
  const skipped: string[] = [];
  let content: string | null = null;
  const picked: PickedSkillFile[] = [];
  for (const { file, path } of entries) {
    if (!path.startsWith(root)) { skipped.push(`${path}（不在 ${SKILL_DOCUMENT} 所在目录）`); continue; }
    const relative = path.slice(root.length);
    if (IGNORED.test(relative)) continue;
    if (relative === SKILL_DOCUMENT) {
      content = await text(file);
      if (content === null) skipped.push(`${SKILL_DOCUMENT}（不是 UTF-8 文本）`);
      continue;
    }
    const problem = skillPathProblem(relative);
    if (problem) { skipped.push(`${relative}（${problem}）`); continue; }
    if (file.size > SKILL_FILE_MAX_BYTES) { skipped.push(`${relative}（超过 ${SKILL_FILE_MAX_BYTES / 1024 / 1024} MB）`); continue; }
    const body = await text(file);
    if (body === null) { skipped.push(`${relative}（不是文本文件）`); continue; }
    picked.push({ path: relative, content: body, bytes: new TextEncoder().encode(body).length });
  }
  picked.sort((a, b) => a.path.localeCompare(b.path));
  if (picked.length > SKILL_FILES_MAX) skipped.push(...picked.splice(SKILL_FILES_MAX).map(file => `${file.path}（超过 ${SKILL_FILES_MAX} 个文件）`));
  return { content, files: picked, skipped };
}
