import 'server-only';

import type { ScopedDb } from '@/lib/db/context.server';
import { buildMembershipInfo } from '@/lib/user/membership';
import type { MembershipInfoSource } from '@/lib/user/membership';
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

async function loadMembershipRow(
  db: ScopedDb,
  userId: string,
) {
  return await db.tx((trx) => trx
    .selectFrom('users')
    .select(['id', 'membership', 'membership_expires_at', 'ai_chat_count'])
    .where('id', '=', userId)
    .executeTakeFirst());
}

async function loadMembershipRowWithRecovery(
  db: ScopedDb,
  userId: string,
) {
  let membershipRow = await loadMembershipRow(db, userId);
  if (membershipRow) {
    return { data: membershipRow, error: null };
  }

  const ensured = await ensureUserRecordRow(db, { id: userId, user_metadata: {} });
  if (!ensured.ok) {
    return {
      data: null,
      error: ensured.error,
    };
  }

  membershipRow = await loadMembershipRow(db, userId);
  return { data: membershipRow, error: null };
}

export async function buildChatBootstrap(
  db: ScopedDb,
  userId: string,
): Promise<ChatBootstrapData> {
  const knowledgeBaseFeatureEnabled = await isFeatureModuleEnabled('knowledge-base');
  const { data: membershipRow, error: membershipError } = await loadMembershipRowWithRecovery(db, userId)
    .catch((error) => ({ data: null, error }));

  if (membershipError) {
    throw resolveChatBootstrapError('load users row', membershipError);
  }
  if (!membershipRow || typeof membershipRow.ai_chat_count !== 'number') {
    throw resolveChatBootstrapError('missing or invalid users row', membershipRow);
  }

  const membership = buildMembershipInfo(membershipRow as MembershipInfoSource);

  const promptKbIds = membership?.type === 'free' || !knowledgeBaseFeatureEnabled
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

  if (membership?.type === 'free' || !knowledgeBaseFeatureEnabled || promptKbIds.length === 0) {
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
