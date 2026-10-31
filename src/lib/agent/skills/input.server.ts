import 'server-only';
import { parse } from 'yaml';
import {
  SKILL_CONTENT_MAX_BYTES, SKILL_DESCRIPTION_MAX, SKILL_DOCUMENT, SKILL_FILE_MAX_BYTES, SKILL_FILES_MAX, SKILL_NAME_MAX,
  SKILL_NAME_PATTERN, skillPathProblem,
} from './config';

/** A submission the settings pages can show as is. */
export class SkillInputError extends Error {}

const fail = (message: string): never => { throw new SkillInputError(message); };
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/** SKILL.md split as pi splits it: a leading `---` block up to the next `---` line is the frontmatter. */
function split(content: string): { frontmatter: string | null; body: string } {
  if (!content.startsWith('---')) return { frontmatter: null, body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: null, body: content };
  return { frontmatter: content.slice(4, end), body: content.slice(end + 4).trim() };
}

/** The instructions of a stored SKILL.md: what follows the frontmatter. */
export function skillBody(content: string): string {
  return split(content).body.trim();
}

export type SkillDocument = {
  /** SKILL.md without a byte order mark, with `\n` line ends. */
  content: string;
  name: string;
  description: string;
  manualOnly: boolean;
};

/**
 * Reads SKILL.md as pi does (YAML frontmatter; `name`, `description`, `disable-model-invocation: true`) and holds it
 * to the Agent Skills limits pi only warns about, since a stored skill must load in every task.
 */
export function parseSkillDocument(raw: string): SkillDocument {
  const content = raw.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  if (bytes(content) > SKILL_CONTENT_MAX_BYTES) fail(`${SKILL_DOCUMENT} 最大 ${SKILL_CONTENT_MAX_BYTES / 1024} KB`);
  if (content.includes('\u0000')) fail(`${SKILL_DOCUMENT} 不是文本`);
  const { frontmatter, body } = split(content);
  if (frontmatter === null) fail(`${SKILL_DOCUMENT} 开头需要用 --- 包住的 frontmatter，写明 name 与 description`);
  let data: unknown;
  try {
    data = parse(frontmatter as string);
  } catch (error) {
    fail(`frontmatter 不是有效的 YAML：${error instanceof Error ? error.message.split('\n')[0] : '无法解析'}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('frontmatter 须是 name、description 等键值');
  const fields = data as Record<string, unknown>;
  const name = fields.name;
  if (typeof name !== 'string' || !name) fail('frontmatter 缺少 name');
  if ((name as string).length > SKILL_NAME_MAX || !SKILL_NAME_PATTERN.test(name as string))
    fail(`name「${String(name).slice(0, 80)}」无效：只能用小写字母、数字和单个连字符，不能以连字符开头或结尾，最长 ${SKILL_NAME_MAX} 个字符`);
  const description = typeof fields.description === 'string' ? fields.description.trim() : '';
  if (!description) fail('frontmatter 缺少 description：写明这个技能做什么、什么时候用');
  if (description.length > SKILL_DESCRIPTION_MAX) fail(`description 最多 ${SKILL_DESCRIPTION_MAX} 个字符`);
  if (!body) fail(`${SKILL_DOCUMENT} 在 frontmatter 之后没有正文`);
  return { content, name: name as string, description, manualOnly: fields['disable-model-invocation'] === true };
}

export type SkillFileChange = { path: string; content?: string };

export type SkillFields = {
  document: SkillDocument;
  /** The complete set of files: an entry without content keeps the stored file. */
  files: SkillFileChange[];
  enabled: boolean;
  sortOrder: number;
};

function files(value: unknown): SkillFileChange[] {
  if (!Array.isArray(value)) return fail('附属文件格式无效');
  if (value.length > SKILL_FILES_MAX) fail(`附属文件最多 ${SKILL_FILES_MAX} 个`);
  const seen = new Set<string>();
  return value.map((entry): SkillFileChange => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('附属文件格式无效');
    const { path, content } = entry as { path?: unknown; content?: unknown };
    if (typeof path !== 'string') return fail('附属文件缺少路径');
    const problem = skillPathProblem(path);
    if (problem) fail(problem);
    if (seen.has(path)) fail(`附属文件「${path}」重复`);
    seen.add(path);
    if (content === undefined) return { path };
    if (typeof content !== 'string' || content.includes('\u0000')) return fail(`附属文件「${path}」不是文本`);
    if (bytes(content) > SKILL_FILE_MAX_BYTES) fail(`附属文件「${path}」超过 ${SKILL_FILE_MAX_BYTES / 1024 / 1024} MB`);
    return { path, content };
  });
}

/** Checks a settings page's submission; `partial` is an edit, where an absent field keeps what is stored. */
export function parseSkillInput(value: unknown, partial: boolean): Partial<SkillFields> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('技能格式无效');
  const raw = value as Record<string, unknown>;
  const result: Partial<SkillFields> = {};
  if (raw.content !== undefined || !partial) {
    if (typeof raw.content !== 'string' || !raw.content.trim()) fail(`请填写 ${SKILL_DOCUMENT}`);
    result.document = parseSkillDocument(raw.content as string);
  }
  if (raw.files !== undefined) result.files = files(raw.files);
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') fail('启用状态无效');
    result.enabled = raw.enabled as boolean;
  }
  if (raw.sortOrder !== undefined) {
    if (!Number.isInteger(raw.sortOrder) || (raw.sortOrder as number) < -10_000 || (raw.sortOrder as number) > 10_000) fail('排序须为 -10000–10000 的整数');
    result.sortOrder = raw.sortOrder as number;
  }
  return result;
}
