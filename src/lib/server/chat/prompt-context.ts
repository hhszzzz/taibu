import 'server-only';

import { buildPromptWithSources, calculatePromptBudget, resolvePersonalities } from '@/lib/ai/prompt-builder';
import { getSystemAdminClient } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { buildKnowledgeHits } from '@/lib/knowledge-base/hits';
import { parseMentions, resolveMention, stripMentionTokens } from '@/lib/mentions';
import type { ChatMessage } from '@/types';
import type { ChatPromptContext } from '@/lib/server/chat/contracts';
import type { Mention } from '@/types/mentions';
import { buildDreamContextPayload } from '@/lib/chat/chat-context';
import { extractUserQuestion } from '@/lib/chat/message-utils';
import type { ResolvedChatRequest } from '@/lib/server/chat/request';
import { isFeatureModuleEnabled } from '@/lib/app-settings';
import { getUserSettingsSnapshot, type UserIdentityProfile } from '@/lib/user/settings';
import { normalizeVisualizationSettings, type VisualizationSettings } from '@/lib/visualization/settings';
import { DEFAULT_DIMENSIONS } from '@/lib/visualization/dimensions';

/** 用户未保存可视化设置时的默认配置 */
const DEFAULT_VISUALIZATION_SETTINGS: VisualizationSettings = {
  selectedDimensions: DEFAULT_DIMENSIONS,
  dayunDisplayCount: 5,
  chartStyle: 'modern',
};

function injectToLastUserMessage(messages: ChatMessage[], prefix: string): ChatMessage[] {
  if (!prefix) return messages;
  return messages.map((msg, index) => {
    if (index === messages.length - 1 && msg.role === 'user') {
      return { ...msg, content: prefix + msg.content };
    }
    return msg;
  });
}

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

async function resolveMentionsForPrompt(
  mentions: Mention[],
  userId: string,
  supabase: ReturnType<typeof getSystemAdminClient>,
  maxTokens: number,
  chartPromptDetailLevel: 'default' | 'more' | 'full',
): Promise<ResolvedMention[]> {
  return await Promise.all(mentions.map(async (mention) => {
    const resolvedContent = await resolveMention(mention, userId, {
      client: supabase,
      db: systemDb(),
      maxTokens,
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
    visualizationSettings: normalizeVisualizationSettings(settings.visualizationSettings) ?? DEFAULT_VISUALIZATION_SETTINGS,
  };
}

function applyUserSettingsOverrides(
  settings: UserSettingsContext,
  overrides: Pick<ResolvedChatRequest['body'], 'expressionStyle' | 'customInstructions' | 'userProfile' | 'visualizationSettings'>
): UserSettingsContext {
  return {
    expressionStyle: overrides.expressionStyle === 'gentle' ? 'gentle' : (
      overrides.expressionStyle === 'direct' ? 'direct' : settings.expressionStyle
    ),
    chartPromptDetailLevel: settings.chartPromptDetailLevel,
    memoryEnabled: settings.memoryEnabled,
    customInstructions: overrides.customInstructions === null
      ? ''
      : typeof overrides.customInstructions === 'string'
      ? overrides.customInstructions
      : settings.customInstructions,
    userProfile: overrides.userProfile !== undefined ? overrides.userProfile : settings.userProfile,
    promptKbIds: settings.promptKbIds,
    visualizationSettings: overrides.visualizationSettings || settings.visualizationSettings,
  };
}

export async function buildChatPromptContext(
  resolvedRequest: ResolvedChatRequest,
  options?: { deferKnowledgeSearch?: boolean },
): Promise<ChatPromptContextResult> {
  const { body, userId, accessTokenForKB, requestedModelId, reasoningEnabled, membershipType } = resolvedRequest;

  const supabase = getSystemAdminClient();
  const knowledgeBaseFeatureEnabled = await isFeatureModuleEnabled('knowledge-base');

  let dreamContext: { baziChartName?: string; dailyFortune?: string } | undefined;
  let dreamPayload: { baziText?: string; fortuneText?: string } | undefined;
  if (body.dreamMode && userId) {
    const { payload, context } = await buildDreamContextPayload(userId);
    dreamPayload = payload;
    dreamContext = context;
  }

  const lastUserMessage = [...body.messages].reverse().find((message) => message.role === 'user');
  const rawUserContent = lastUserMessage?.content || '';
  const userQuestionForSearch = extractUserQuestion(rawUserContent);
  const canUsePromptKnowledgeBase = knowledgeBaseFeatureEnabled && membershipType !== 'free';
  const mergedMentions = mergeMentions(rawUserContent, body.mentions);
  const effectiveMentions = canUsePromptKnowledgeBase
    ? mergedMentions
    : mergedMentions.filter((mention) => mention.type !== 'knowledge_base');

  const mentionBudget = await calculatePromptBudget(requestedModelId, reasoningEnabled);
  const userSettings = userId ? await loadUserSettingsContext(userId) : {
    expressionStyle: 'direct' as const,
    chartPromptDetailLevel: 'default' as const,
    userProfile: null,
    customInstructions: '',
    promptKbIds: [] as string[],
  };

  const resolvedMentions = userId
    ? await resolveMentionsForPrompt(effectiveMentions, userId, supabase, mentionBudget, userSettings.chartPromptDetailLevel)
    : [];

  const effectiveUserSettings = applyUserSettingsOverrides(userSettings, {
    expressionStyle: body.expressionStyle,
    customInstructions: body.customInstructions,
    userProfile: body.userProfile,
    visualizationSettings: body.visualizationSettings,
  });

  const promptKnowledgeBases = userId && canUsePromptKnowledgeBase && effectiveUserSettings.promptKbIds.length > 0
    ? await (async () => {
      const kbRows = await systemDb().tx((trx) => trx
        .selectFrom('knowledge_bases')
        .select(['id', 'name'])
        .where('user_id', '=', userId)
        .where('id', 'in', effectiveUserSettings.promptKbIds)
        .execute());
      const kbMap = new Map<string, { id: string; name: string }>();
      kbRows.forEach((kb) => {
        kbMap.set(kb.id, kb);
      });

      return effectiveUserSettings.promptKbIds
        .map((kbId) => kbMap.get(kbId))
        .filter((kb): kb is { id: string; name: string } => !!kb);
    })().catch(() => {
      console.warn('[knowledge-base] enrichment failed', { stage: 'prompt-names' });
      return [];
    })
    : [];

  const knowledgeHits = userId && canUsePromptKnowledgeBase && !options?.deferKnowledgeSearch
    ? await buildKnowledgeHits({
        query: userQuestionForSearch,
        userId,
        membershipType,
        accessToken: accessTokenForKB,
        promptKbIds: effectiveUserSettings.promptKbIds,
        supabase,
        knownNames: { userId, names: new Map(promptKnowledgeBases.map(kb => [kb.id, kb.name])) },
      })
    : [];

  const promptChartContext = body.mangpaiMode
    ? { analysisMode: 'mangpai' as const }
    : undefined;
  const promptDreamMode = body.dreamMode
    ? {
        enabled: true,
        baziText: dreamPayload?.baziText,
        fortuneText: dreamPayload?.fortuneText,
      }
    : undefined;

  const personalityResolution = resolvePersonalities({
    chartContext: promptChartContext,
    dreamMode: promptDreamMode,
    mentions: resolvedMentions,
  });

  const promptBuild = await buildPromptWithSources({
    modelId: requestedModelId,
    reasoningEnabled,
    userMessage: userQuestionForSearch,
    mentions: resolvedMentions,
    knowledgeHits,
    userSettings: effectiveUserSettings,
    chartContext: promptChartContext,
    dreamMode: promptDreamMode,
    difyContext: body.difyContext,
  }, { budget: mentionBudget, personalityResolution });

  const processedMessages = promptBuild.userMessagePrefix
    ? injectToLastUserMessage(body.messages, promptBuild.userMessagePrefix)
    : body.messages;

  const metadata = {
    sources: promptBuild.sources,
    kbSearchEnabled: knowledgeBaseFeatureEnabled && membershipType !== 'free' && effectiveUserSettings.promptKbIds.length > 0,
    kbHitCount: knowledgeHits.length,
    promptDiagnostics: {
      modelId: requestedModelId,
      layers: promptBuild.diagnostics,
      totalTokens: promptBuild.totalTokens,
      budgetTotal: promptBuild.budgetTotal,
      userMessageTokens: promptBuild.userMessageTokens,
    },
    dreamContext,
  };

  const sanitizedMessages = processedMessages.map((message, index) => {
    if (index === processedMessages.length - 1 && message.role === 'user') {
      return { ...message, content: stripMentionTokens(message.content) };
    }
    return message;
  });

  const fallbackPersonality = personalityResolution.personalities[0] ?? 'general';

  return {
    sanitizedMessages,
    agentMemoryEnabled: effectiveUserSettings.memoryEnabled === true,
    metadata,
    fallbackPersonality,
    systemPrompt: promptBuild.systemPrompt,
    promptKnowledgeBases,
  };
}
