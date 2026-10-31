import 'server-only';

import type { ScopedDb } from '@/lib/db/context.server';
import type { ChatBootstrapData, ChatBootstrapKnowledgeBase } from '@/lib/chat/bootstrap';
import { isFeatureModuleEnabled } from '@/lib/app-settings';
import { ensureUserRecordRow } from '@/lib/user/profile-record';

function resolveChatBootstrapError(message: string, error?: unknown): Error {
  if (error) {
    console.error('[chat/bootstrap] failed:', message, error);
  }
  return new Error('加载对话上下文失败');
}

type PromptSettingsRow = {
  prompt_kb_ids?: unknown;
};

function toPromptKnowledgeBaseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

async function loadUserRow(
  db: ScopedDb,
  userId: string,
) {
  return await db.tx((trx) => trx
    .selectFrom('users')
    .select(['id'])
    .where('id', '=', userId)
    .executeTakeFirst());
}

async function loadUserRowWithRecovery(
  db: ScopedDb,
  userId: string,
) {
  let userRow = await loadUserRow(db, userId);
  if (userRow) {
    return { data: userRow, error: null };
  }

  const ensured = await ensureUserRecordRow(db, { id: userId });
  if (!ensured.ok) {
    return {
      data: null,
      error: ensured.error,
    };
  }

  userRow = await loadUserRow(db, userId);
  return { data: userRow, error: null };
}

export async function buildChatBootstrap(
  db: ScopedDb,
  userId: string,
): Promise<ChatBootstrapData> {
  const knowledgeBaseFeatureEnabled = await isFeatureModuleEnabled('knowledge-base');
  const { data: userRow, error: userError } = await loadUserRowWithRecovery(db, userId)
    .catch((error) => ({ data: null, error }));

  if (userError) {
    throw resolveChatBootstrapError('load users row', userError);
  }
  if (!userRow) {
    throw resolveChatBootstrapError('missing users row');
  }

  const promptKbIds = !knowledgeBaseFeatureEnabled
    ? []
    : await (async () => {
      const settingsRow = await db.tx((trx) => trx
        .selectFrom('user_settings')
        .select('prompt_kb_ids')
        .where('user_id', '=', userId)
        .executeTakeFirst()).catch((error) => {
        throw resolveChatBootstrapError('load user settings', error);
      });
      return toPromptKnowledgeBaseIds((settingsRow as PromptSettingsRow | null)?.prompt_kb_ids);
    })();

  if (!knowledgeBaseFeatureEnabled || promptKbIds.length === 0) {
    return {
      userId,
      promptKnowledgeBaseIds: [],
      promptKnowledgeBases: [],
    };
  }

  const kbRows = await db.tx((trx) => trx
    .selectFrom('knowledge_bases')
    .select(['id', 'name', 'description'])
    .where('user_id', '=', userId)
    .where('id', 'in', promptKbIds)
    .execute()).catch((error) => {
    throw resolveChatBootstrapError('load knowledge bases', error);
  });

  const kbMap = new Map(
    (kbRows as ChatBootstrapKnowledgeBase[]).map((kb) => [kb.id, kb] as const)
  );

  return {
    userId,
    promptKnowledgeBaseIds: promptKbIds,
    promptKnowledgeBases: promptKbIds
      .map((kbId) => kbMap.get(kbId))
      .filter((kb): kb is ChatBootstrapKnowledgeBase => !!kb),
  };
}
