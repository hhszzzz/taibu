import 'server-only';

import { buildPromptWithSources, calculatePromptBudget } from '@/lib/ai/prompt-builder';
import { systemDb } from '@/lib/db/context.server';
import { buildKnowledgeHits } from '@/lib/knowledge-base/hits';
import { parseMentions, resolveMention, stripMentionTokens } from '@/lib/mentions';
import type { ChatPromptContext } from '@/lib/server/chat/contracts';
import type { Mention } from '@/types/mentions';
import { extractUserQuestion } from '@/lib/chat/message-utils';
import type { ResolvedChatRequest } from '@/lib/server/chat/request';
import { isFeatureModuleEnabled } from '@/lib/app-settings';
import { getUserSettingsSnapshot, type UserIdentityProfile } from '@/lib/user/settings';
import { normalizeVisualizationSettings, type VisualizationSettings } from '@/lib/visualization/settings';
import { searchChatWeb } from '@/lib/ai/web-search.server';
import { resolveUserTimeZone } from '@/lib/ai/prompt-time';

type UserSettingsContext = {
  memoryEnabled?: boolean;
  expressionStyle: 'direct' | 'gentle';
  chartPromptDetailLevel: 'default' | 'more' | 'full';
  userProfile: UserIdentityProfile | null;
  customInstructions: string;
  promptKbIds: string[];
  visualizationSettings?: VisualizationSettings;
};

type ChatPromptContextResult = ChatPromptContext;

type ResolvedMention = Mention & { resolvedContent: string };

function mergeMentions(rawUserContent: string, mentions?: Mention[]): Mention[] {
  const parsedMentions = parseMentions(rawUserContent);
  return [...(mentions || []), ...parsedMentions]
    .filter((mention) => mention && mention.type && mention.name)
    .slice(0, 20);
}

function mentionKey(mention: Mention): string {
  return `${mention.type}:${mention.id ?? mention.name}`;
}

function dedupeMentions(mentions: Mention[]): Mention[] {
  const seen = new Set<string>();
  return mentions.filter((mention) => {
    const key = mentionKey(mention);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * History keeps only the display name (`@命盘名`), not the structured mention, so a follow-up like 「继续」 would
 * reach the model without the chart it was talking about. Carry the most recent earlier turn's mentions forward
 * when the current turn names none of its own.
 */
function inheritedMentions(messages: ResolvedChatRequest['body']['messages'], currentIndex: number): Mention[] {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.mentions?.length) return message.mentions;
  }
  return [];
}

/** 直聊按会话里持久化的结构化 mention 逐轮解析；Agent 仍用自己的工具上下文。 */
function conversationMentions(messages: ResolvedChatRequest['body']['messages'], currentIndex: number): Mention[] {
  const collected: Mention[] = [];
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.mentions?.length) collected.push(...message.mentions);
  }
  return dedupeMentions(collected);
}

async function resolveMentionsForPrompt(
  mentions: Mention[],
  userId: string,
  maxTokens: number,
  chartPromptDetailLevel: 'default' | 'more' | 'full',
  model: string,
): Promise<ResolvedMention[]> {
  return await Promise.all(mentions.map(async (mention) => {
    const resolvedContent = await resolveMention(mention, userId, {
      db: systemDb(),
      maxTokens,
      model,
      chartPromptDetailLevel,
    });
    return { ...mention, resolvedContent };
  }));
}

async function loadUserSettingsContext(
  userId: string
): Promise<UserSettingsContext> {
  const { settings } = await getUserSettingsSnapshot(systemDb(), userId);

  return {
    expressionStyle: settings.expressionStyle,
    memoryEnabled: settings.chatPreferences.memoryEnabled === true,
    chartPromptDetailLevel: settings.chartPromptDetailLevel,
    userProfile: settings.userProfile,
    customInstructions: settings.customInstructions,
    promptKbIds: settings.promptKbIds,
    // 用户没有保存过可视化偏好时就是「无」：不注入维度、大运期数或图表风格。
    visualizationSettings: normalizeVisualizationSettings(settings.visualizationSettings),
  };
}

function applyUserSettingsOverrides(
  settings: UserSettingsContext,
  overrides: Pick<ResolvedChatRequest['body'], 'expressionStyle' | 'customInstructions' | 'userProfile' | 'visualizationSettings'>
): UserSettingsContext {
  return {
    ...settings,
    expressionStyle: overrides.expressionStyle === 'gentle' ? 'gentle' : (
      overrides.expressionStyle === 'direct' ? 'direct' : settings.expressionStyle
    ),
    customInstructions: overrides.customInstructions === null
      ? ''
      : typeof overrides.customInstructions === 'string'
      ? overrides.customInstructions
      : settings.customInstructions,
    userProfile: overrides.userProfile !== undefined ? overrides.userProfile : settings.userProfile,
    visualizationSettings: overrides.visualizationSettings || settings.visualizationSettings,
  };
}

/** The user's prompt knowledge bases, in the order they set them; unreadable rows are left out. */
async function promptKnowledgeBasesOf(
  userId: string | null,
  ids: readonly string[],
): Promise<Array<{ id: string; name: string }>> {
  if (!userId || !ids.length) return [];
  try {
    const rows = await systemDb().tx((trx) => trx
      .selectFrom('knowledge_bases')
      .select(['id', 'name'])
      .where('user_id', '=', userId)
      .where('id', 'in', ids)
      .execute());
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  } catch {
    console.warn('[knowledge-base] enrichment failed', { stage: 'prompt-names' });
    return [];
  }
}

export interface ChatPromptContextOptions {
  deferKnowledgeSearch?: boolean;
  /** Granted by the admitting adapter, never read from the body: the preview builds the same context and must not search. */
  webSearch?: boolean;
  conversationMentions?: boolean;
  modelWindow?: { contextWindow?: number | null; maxOutput?: number | null };
  /** 普通对话底座（角色 + 解读通则）；Agent 传 false，解读规则由 load_skill 的方法卡提供 */
  includeBaseRole?: boolean;
  /** 用户消息开头的发送时间；Agent 传 false，改用 current_time 工具 */
  includeSentAt?: boolean;
}

export async function buildChatPromptContext(
  resolvedRequest: ResolvedChatRequest,
  options?: ChatPromptContextOptions,
): Promise<ChatPromptContextResult> {
  const { body, userId, requestedModelId, reasoningEnabled } = resolvedRequest;
  const knowledgeBaseFeatureEnabled = await isFeatureModuleEnabled('knowledge-base');

  const lastUserMessage = [...body.messages].reverse().find((message) => message.role === 'user');
  const rawUserContent = lastUserMessage?.content || '';
  const userQuestionForSearch = extractUserQuestion(rawUserContent);
  // Runs while the rest of the context loads; mention tokens never leave for the search provider.
  const webSearch = options?.webSearch ? searchChatWeb(stripMentionTokens(userQuestionForSearch)) : undefined;
  const canUsePromptKnowledgeBase = knowledgeBaseFeatureEnabled;
  const currentMentions = dedupeMentions(
    mergeMentions(rawUserContent, body.mentions).concat(lastUserMessage?.mentions ?? []),
  ).slice(0, 20);
  // 「继续」之类的新消息没有 @，但要接着上一条消息的命盘/资料回答。
  const lastUserIndex = lastUserMessage ? body.messages.lastIndexOf(lastUserMessage) : -1;
  const mergedMentions = options?.conversationMentions
    ? dedupeMentions([...currentMentions, ...conversationMentions(body.messages, lastUserIndex)]).slice(0, 10)
    : currentMentions.length
      ? currentMentions
      : dedupeMentions(inheritedMentions(body.messages, lastUserIndex));
  const effectiveMentions = canUsePromptKnowledgeBase
    ? mergedMentions
    : mergedMentions.filter((mention) => mention.type !== 'knowledge_base');

  const mentionBudget = await calculatePromptBudget(requestedModelId, reasoningEnabled, options?.modelWindow);
  const userSettings = userId ? await loadUserSettingsContext(userId) : {
    expressionStyle: 'direct' as const,
    chartPromptDetailLevel: 'default' as const,
    userProfile: null,
    customInstructions: '',
    promptKbIds: [] as string[],
  };

  const resolvedMentions = userId
    ? await resolveMentionsForPrompt(effectiveMentions, userId, mentionBudget, userSettings.chartPromptDetailLevel, requestedModelId)
    : [];

  const effectiveUserSettings = applyUserSettingsOverrides(userSettings, {
    expressionStyle: body.expressionStyle,
    customInstructions: body.customInstructions,
    userProfile: body.userProfile,
    visualizationSettings: body.visualizationSettings,
  });

  const promptKnowledgeBases = canUsePromptKnowledgeBase
    ? await promptKnowledgeBasesOf(userId, effectiveUserSettings.promptKbIds)
    : [];

  const knowledgeHits = userId && canUsePromptKnowledgeBase && !options?.deferKnowledgeSearch
    ? await buildKnowledgeHits({
        query: userQuestionForSearch,
        userId,
        promptKbIds: effectiveUserSettings.promptKbIds,
        db: systemDb(),
        knownNames: { userId, names: new Map(promptKnowledgeBases.map(kb => [kb.id, kb.name])) },
      })
    : [];

  const web = await webSearch;
  const promptBuild = await buildPromptWithSources({
    modelId: requestedModelId,
    reasoningEnabled,
    modelWindow: options?.modelWindow,
    userMessage: userQuestionForSearch,
    mentions: resolvedMentions,
    knowledgeHits,
    userSettings: effectiveUserSettings,
    ...(options?.includeSentAt === false ? {} : { sentAt: { at: new Date(), timeZone: resolveUserTimeZone(body.timezone) } }),
    quotes: lastUserMessage?.quotes,
    attachments: { file: body.attachment, web },
  }, { budget: mentionBudget, includeBaseRole: options?.includeBaseRole !== false });

  const metadata = {
    sources: promptBuild.sources,
    kbSearchEnabled: canUsePromptKnowledgeBase && effectiveUserSettings.promptKbIds.length > 0,
    kbHitCount: knowledgeHits.length,
    promptDiagnostics: {
      modelId: requestedModelId,
      layers: promptBuild.diagnostics,
      totalTokens: promptBuild.totalTokens,
      budgetTotal: promptBuild.budgetTotal,
      userMessageTokens: promptBuild.userMessageTokens,
    },
    webSearch: web && {
      status: web.status,
      sources: web.status === 'ok' ? web.results.map(({ title, url }) => ({ title, url })) : [],
    },
  };

  // Mention tokens are stripped from what the user typed before the document and search results go in front,
  // since stripping also collapses whitespace and would flatten their paragraphs and table cells. The quotes move
  // into that prefix as well; leaving them on the message would serialize them twice when the Agent rebuilds pi history.
  const sanitizedMessages = body.messages.map((message, index) => {
    if (index === body.messages.length - 1 && message.role === 'user') {
      const sanitized = { ...message, content: promptBuild.userMessagePrefix + stripMentionTokens(message.content) };
      delete sanitized.quotes;
      return sanitized;
    }
    return message;
  });

  return {
    sanitizedMessages,
    agentMemoryEnabled: effectiveUserSettings.memoryEnabled === true,
    metadata,
    systemPrompt: promptBuild.systemPrompt,
    promptKnowledgeBases,
  };
}
