/**
 * Agent skills, shared by the server and the settings pages. A skill is pi's SKILL.md (the Agent Skills format): a
 * frontmatter with its name and description, then the instructions, plus optional text files beside it. Platform
 * skills (owner null) are the administrators'; a user's own skills serve only that user.
 */
import type { MembershipType } from '@/lib/user/membership';

/** pi's rules for a skill name: lowercase letters, digits and single hyphens, at most 64 characters. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
/** SKILL.md as stored, frontmatter included. */
export const SKILL_CONTENT_MAX_BYTES = 128 * 1024;
export const SKILL_FILE_MAX_BYTES = 1024 * 1024;
export const SKILL_FILES_MAX = 64;
export const SKILL_FILES_TOTAL_MAX_BYTES = 8 * 1024 * 1024;
export const SKILL_PATH_MAX = 256;
/** The file the instructions are in; the other files sit beside it. */
export const SKILL_DOCUMENT = 'SKILL.md';

export type SkillScope = 'platform' | 'user';
export type SkillFileView = { path: string; bytes: number };

export type SkillView = {
  id: string;
  scope: SkillScope;
  name: string;
  description: string;
  /** Raised whenever SKILL.md or the files change. */
  version: number;
  requiredTier: MembershipType;
  enabled: boolean;
  /** `disable-model-invocation`: only the user's `/skill:名称` uses it; the model is not told about it. */
  manualOnly: boolean;
  sortOrder: number;
  /** Bytes of SKILL.md. */
  bytes: number;
  files: SkillFileView[];
  /** A user's skill that a platform skill of the same name keeps out of tasks. */
  shadowed: boolean;
  updatedAt: string;
};

/** A skill with its SKILL.md, for the editor. */
export type SkillDetail = SkillView & { content: string };

/**
 * What the settings pages send. `content` is the whole SKILL.md. `files` is the complete set of files the skill keeps:
 * an entry with content adds or replaces that file, an entry without keeps the stored one, and a stored file that is
 * not listed is removed.
 */
export type SkillInput = {
  content?: string;
  files?: Array<{ path: string; content?: string }>;
  requiredTier?: MembershipType;
  enabled?: boolean;
  sortOrder?: number;
};

/** A skill the member can use, as the composer's slash menu lists it. */
export type SkillCommand = { name: string; description: string; scope: SkillScope };

/** A size as the settings pages show it. */
export function formatSkillBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Why a path cannot name a skill's file, or null: a relative path inside the skill, without `.` or `..` parts. */
export function skillPathProblem(path: string): string | null {
  if (!path || path.length > SKILL_PATH_MAX) return `文件路径须为 1–${SKILL_PATH_MAX} 个字符`;
  if (/[\p{Cc}\u2028\u2029\\]/u.test(path)) return `文件路径「${path}」含有不允许的字符`;
  if (path.split('/').some(part => !part || part === '.' || part === '..')) return `文件路径「${path}」须是技能目录内的相对路径`;
  if (path === SKILL_DOCUMENT) return `${SKILL_DOCUMENT} 是技能正文，不作为附属文件`;
  return null;
}

/** `/skill:名称 要求` at the start of a message, as pi reads it; null when the message is not one. */
export function parseSkillCommand(text: string): { name: string; args: string } | null {
  const match = /^\/skill:(\S*)(?:\s+([\s\S]*))?$/u.exec(text);
  return match ? { name: match[1], args: (match[2] ?? '').trim() } : null;
}
