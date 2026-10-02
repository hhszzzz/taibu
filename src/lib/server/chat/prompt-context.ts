import 'server-only';

import { buildPromptWithSources, calculatePromptBudget, resolvePersonalities } from '@/lib/ai/prompt-builder';
import { getSystemAdminClient } from '@/lib/api-utils';
import { buildKnowledgeHits } from '@/lib/knowledge-base/hits';
import { parseMentions, resolveMention, stripMentionTokens } from '@/lib/mentions';
import type { ChatMessage } from '@/types';
import type { ChatPromptContext } from '@/lib/server/chat/contracts';
import type { Mention } from '@/types/mentions';
import { buildDreamContextPayload } from '@/lib/chat/chat-context';
import { extractUserQuestion } from '@/lib/chat/message-utils';
import type { ResolvedChatRequest } from '@/lib/server/chat/request';
import { isFeatureModuleEnabled } from '@/lib/app-settings';
import { normalizeUserSettings, type UserIdentityProfile, USER_SETTINGS_SELECT } from '@/lib/user/settings';
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
    console.log(`[mention-resolve] type=${mention.type} id=${mention.id ?? 'MISSING'} name=${mention.name}`);
    const resolvedContent = await resolveMention(mention, userId, {
      client: supabase,
      maxTokens,
      chartPromptDetailLevel,
    });
    console.log(`[mention-resolve] result: type=${mention.type} contentLen=${resolvedContent?.length ?? 0}`);
    return { ...mention, resolvedContent };
  }));
}

async function loadUserSettingsContext(
  supabase: ReturnType<typeof getSystemAdminClient>,
  userId: string
): Promise<UserSettingsContext> {
  const { data } = await supabase
    .from('user_settings')
    .select(USER_SETTINGS_SELECT)
    .eq('user_id', userId)
    .maybeSingle();
  const settings = normalizeUserSettings((data ?? null) as Record<string, unknown> | null);

  return {
    expressionStyle: settings.expressionStyle,
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
  const userSettings = userId ? await loadUserSettingsContext(supabase, userId) : {
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
      const { data: kbRows } = await supabase
        .from('knowledge_bases')
        .select('id, name')
        .eq('user_id', userId)
        .in('id', effectiveUserSettings.promptKbIds);

      const kbMap = new Map<string, { id: string; name: string }>();
      ((kbRows || []) as Array<{ id: string; name: string }>).forEach((kb) => {
        kbMap.set(kb.id, kb);
      });

      return effectiveUserSettings.promptKbIds
        .map((kbId) => kbMap.get(kbId))
        .filter((kb): kb is { id: string; name: string } => !!kb);
    })()
    : [];

  const knowledgeHits = userId && canUsePromptKnowledgeBase
    ? await buildKnowledgeHits({
        query: userQuestionForSearch,
        userId,
        membershipType,
        accessToken: accessTokenForKB,
        promptKbIds: effectiveUserSettings.promptKbIds,
        supabase,
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
  });

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

  const personalityResolution = resolvePersonalities({
    chartContext: promptChartContext,
    dreamMode: promptDreamMode,
    mentions: resolvedMentions,
  });
  const fallbackPersonality = personalityResolution.personalities[0] ?? 'general';

  return {
    sanitizedMessages,
    metadata,
    fallbackPersonality,
    systemPrompt: promptBuild.systemPrompt,
    promptKnowledgeBases,
  };
}
