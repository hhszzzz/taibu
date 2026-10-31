import 'server-only';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { isUniqueViolation } from '@/lib/db/errors';
import { lockTransactionKey } from '@/lib/db/sql-helpers';
import { createSharedCache } from '@/lib/cache/shared.server';
import { SKILL_FILES_TOTAL_MAX_BYTES, type SkillDetail, type SkillFileView, type SkillView } from './config';
import { SkillInputError, type SkillFields } from './input.server';

/** A skill without its SKILL.md: what lists, the prompt section and the access checks read. */
export interface SkillRow {
  id: string;
  owner_id: string | null;
  name: string;
  description: string;
  version: number;
  is_enabled: boolean;
  disable_model_invocation: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Bytes of SKILL.md. */
  bytes: number;
  files: SkillFileView[];
}

/** Thrown when a user already has as many skills as the policy allows. */
export class SkillLimitError extends Error {}

/** Namespace of the per-owner quota lock (see lockTransactionKey); the connectors' is 912. */
const QUOTA_LOCK = 913;

const platformCache = createSharedCache<SkillRow[]>({ name: 'agent-skills', ttlMs: 60_000 });

const bytesOf = (text: string) => Buffer.byteLength(text, 'utf8');

/** A transaction as ScopedDb hands it out (only the db layer imports Kysely). */
type Trx = Parameters<Parameters<ScopedDb['tx']>[0]>[0];

/** One owner's skills (null: the platform's) without SKILL.md, with its size. */
function skillsOf(trx: Trx, owner: string | null) {
  const query = trx.selectFrom('agent_skills').select([
    'id', 'owner_id', 'name', 'description', 'version', 'is_enabled', 'disable_model_invocation',
    'sort_order', 'created_at', 'updated_at',
  ]).select((eb) => eb.fn<number>('octet_length', ['content']).as('bytes'));
  return owner === null ? query.where('owner_id', 'is', null) : query.where('owner_id', '=', owner);
}

/** The skills with their files' paths and sizes. */
async function withFiles<T extends { id: string; bytes: number }>(trx: Trx, skills: T[]): Promise<Array<T & { files: SkillFileView[] }>> {
  const files = skills.length ? await trx.selectFrom('agent_skill_files')
    .select(['skill_id', 'path']).select((eb) => eb.fn<number>('octet_length', ['content']).as('bytes'))
    .where('skill_id', 'in', skills.map((skill) => skill.id)).orderBy('path', 'asc').execute() : [];
  return skills.map((skill) => ({
    ...skill, bytes: Number(skill.bytes),
    files: files.filter((file) => file.skill_id === skill.id).map((file) => ({ path: file.path, bytes: Number(file.bytes) })),
  }));
}

async function skillRow(trx: Trx, owner: string | null, id: string): Promise<SkillRow> {
  const [row] = await withFiles(trx, [await skillsOf(trx, owner).where('id', '=', id).executeTakeFirstOrThrow()]);
  return row as unknown as SkillRow;
}

export async function listSkillRows(db: ScopedDb, owner: string | null): Promise<SkillRow[]> {
  return (await db.tx(async (trx) => withFiles(trx, await skillsOf(trx, owner)
    .orderBy('created_at', 'desc').execute()))) as unknown as SkillRow[];
}

export async function getSkillDetailRow(db: ScopedDb, owner: string | null, id: string): Promise<(SkillRow & { content: string }) | undefined> {
  return (await db.tx(async (trx) => {
    const row = await skillsOf(trx, owner).select('content').where('id', '=', id).executeTakeFirst();
    return row ? (await withFiles(trx, [row]))[0] : undefined;
  })) as unknown as (SkillRow & { content: string }) | undefined;
}

/** Platform skills for every task and listing, shared across processes; administrator writes invalidate it. */
export function platformSkills(): Promise<SkillRow[]> {
  return platformCache.load(() => listSkillRows(systemDb(), null));
}

export function invalidatePlatformSkills(): Promise<void> {
  return platformCache.invalidate();
}

/** One user's skills as the worker reads them: fresh on every task and every call. */
export function userSkills(userId: string): Promise<SkillRow[]> {
  return listSkillRows(systemDb(), userId);
}

/** SKILL.md of a skill the caller already found available. */
export async function readSkillContent(id: string): Promise<string | undefined> {
  return (await systemDb().tx((trx) => trx.selectFrom('agent_skills').select('content').where('id', '=', id).executeTakeFirst()))?.content;
}

export async function readSkillFile(skillId: string, path: string): Promise<string | undefined> {
  return (await systemDb().tx((trx) => trx.selectFrom('agent_skill_files').select('content')
    .where('skill_id', '=', skillId).where('path', '=', path).executeTakeFirst()))?.content;
}

/** Enabled skills only: a retired skill stays stored but does not take an active slot. */
export async function countSkills(db: ScopedDb, owner: string): Promise<number> {
  const { count } = await db.tx((trx) => trx.selectFrom('agent_skills')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('owner_id', '=', owner).where('is_enabled', '=', true).executeTakeFirstOrThrow());
  return Number(count);
}

function nameTaken(error: unknown): never {
  if (isUniqueViolation(error)) throw new SkillInputError('已有同名技能，请修改 SKILL.md 里的 name');
  throw error;
}

function totalChecked(sizes: number[]) {
  if (sizes.reduce((sum, size) => sum + size, 0) > SKILL_FILES_TOTAL_MAX_BYTES)
    throw new SkillInputError(`附属文件合计最大 ${SKILL_FILES_TOTAL_MAX_BYTES / 1024 / 1024} MB`);
}

/** `limit` (users only) is checked under a per-owner lock, so concurrent additions cannot exceed it. */
export async function insertSkill(
  db: ScopedDb, owner: string | null, fields: Partial<SkillFields> & Pick<SkillFields, 'document'>, options: { limit?: number } = {},
): Promise<SkillRow> {
  const files = fields.files ?? [];
  const missing = files.find((file) => file.content === undefined);
  if (missing) throw new SkillInputError(`附属文件「${missing.path}」缺少内容`);
  totalChecked(files.map((file) => bytesOf(file.content!)));
  try {
    return await db.tx(async (trx) => {
      if (owner !== null && options.limit !== undefined) {
        await lockTransactionKey(trx, owner, QUOTA_LOCK);
        // 额度按启用中的技能计算；新增超出时停用最早添加的技能，让最新的技能生效。
        const enabled = await trx.selectFrom('agent_skills').select('id')
          .where('owner_id', '=', owner).where('is_enabled', '=', true)
          .orderBy('created_at', 'asc').limit(options.limit).execute();
        if (enabled.length >= options.limit) {
          const retire = enabled.slice(0, enabled.length - options.limit + 1).map((row) => row.id);
          await trx.updateTable('agent_skills').set({ is_enabled: false }).where('id', 'in', retire).execute();
        }
      }
      const { id } = await trx.insertInto('agent_skills').values({
        owner_id: owner, name: fields.document.name, description: fields.document.description, content: fields.document.content,
        disable_model_invocation: fields.document.manualOnly,
        is_enabled: fields.enabled ?? true, sort_order: fields.sortOrder ?? 0,
      }).returning('id').executeTakeFirstOrThrow();
      if (files.length) await trx.insertInto('agent_skill_files')
        .values(files.map((file) => ({ skill_id: id, path: file.path, content: file.content! }))).execute();
      return skillRow(trx, owner, id);
    });
  } catch (error) {
    return nameTaken(error);
  }
}

/**
 * Applies an edit. `files` is the complete set the skill keeps (see SkillInput); a change to SKILL.md or to the files
 * raises the version, so a task that loaded the skill can tell it changed.
 */
export async function updateSkill(db: ScopedDb, owner: string | null, id: string, fields: Partial<SkillFields>): Promise<SkillRow | undefined> {
  try {
    return await db.tx(async (trx) => {
      const scoped = trx.selectFrom('agent_skills').select(['id', 'content']).where('id', '=', id);
      const current = await (owner === null ? scoped.where('owner_id', 'is', null) : scoped.where('owner_id', '=', owner))
        .forUpdate().executeTakeFirst();
      if (!current) return undefined;
      let filesChanged = false;
      if (fields.files) {
        const stored = new Map((await trx.selectFrom('agent_skill_files').select('path')
          .select((eb) => eb.fn<number>('octet_length', ['content']).as('bytes')).where('skill_id', '=', id).execute())
          .map((file) => [file.path, Number(file.bytes)]));
        const kept = fields.files.find((file) => file.content === undefined && !stored.has(file.path));
        if (kept) throw new SkillInputError(`附属文件「${kept.path}」已不存在，请重新上传`);
        totalChecked(fields.files.map((file) => file.content === undefined ? stored.get(file.path)! : bytesOf(file.content)));
        const listed = new Set(fields.files.map((file) => file.path));
        const removed = [...stored.keys()].filter((path) => !listed.has(path));
        const written = fields.files.filter((file) => file.content !== undefined);
        if (removed.length) await trx.deleteFrom('agent_skill_files').where('skill_id', '=', id).where('path', 'in', removed).execute();
        if (written.length) await trx.insertInto('agent_skill_files')
          .values(written.map((file) => ({ skill_id: id, path: file.path, content: file.content! })))
          .onConflict((conflict) => conflict.columns(['skill_id', 'path']).doUpdateSet((eb) => ({ content: eb.ref('excluded.content') })))
          .execute();
        filesChanged = removed.length > 0 || written.length > 0;
      }
      const document = fields.document && fields.document.content !== current.content ? fields.document : undefined;
      const set = {
        ...(document ? {
          name: document.name, description: document.description, content: document.content,
          disable_model_invocation: document.manualOnly,
        } : {}),
        ...(fields.enabled !== undefined ? { is_enabled: fields.enabled } : {}),
        ...(fields.sortOrder !== undefined ? { sort_order: fields.sortOrder } : {}),
      };
      const bump = document !== undefined || filesChanged;
      if (bump || Object.keys(set).length) await trx.updateTable('agent_skills')
        .set((eb) => ({ ...set, ...(bump ? { version: eb('version', '+', 1) } : {}) })).where('id', '=', id).execute();
      return skillRow(trx, owner, id);
    });
  } catch (error) {
    return nameTaken(error);
  }
}

export async function deleteSkill(db: ScopedDb, owner: string | null, id: string): Promise<boolean> {
  const deleted = await db.tx((trx) => {
    const query = trx.deleteFrom('agent_skills').where('id', '=', id);
    return (owner === null ? query.where('owner_id', 'is', null) : query.where('owner_id', '=', owner)).returning('id').execute();
  });
  return deleted.length > 0;
}

/** The browser's view. `platformNames` marks a user's skill that a platform skill of the same name keeps out of tasks. */
export function toSkillView(row: SkillRow, platformNames?: ReadonlySet<string>): SkillView {
  return {
    id: row.id,
    scope: row.owner_id === null ? 'platform' : 'user',
    name: row.name,
    description: row.description,
    version: row.version,
    enabled: row.is_enabled,
    manualOnly: row.disable_model_invocation,
    sortOrder: row.sort_order,
    bytes: row.bytes,
    files: row.files,
    shadowed: row.owner_id !== null && platformNames?.has(row.name) === true,
    updatedAt: row.updated_at,
  };
}

export function toSkillDetail(row: SkillRow & { content: string }, platformNames?: ReadonlySet<string>): SkillDetail {
  return { ...toSkillView(row, platformNames), content: row.content };
}
