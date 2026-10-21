import 'server-only';

import { resolveModelContextConfig } from '@/lib/ai/prompt-builder';
import { countMessageTokens } from '@/lib/token-utils';
import { normalizeVisualizationSettings } from '@/lib/visualization/settings';
import { normalizeIdentityUserProfile } from '@/lib/user/settings';
import type { requireUserContext } from '@/lib/api-utils';
import type { ChatRequestBody } from '@/lib/server/chat/request';
import type { ResolvedChatRequest } from '@/lib/server/chat/request';
import type { buildChatPromptContext } from '@/lib/server/chat/prompt-context';
import type { ChatMessage, DifyContext } from '@/types';
import type { Mention } from '@/types/mentions';

type PreviewAuthContext = Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>;
type PreviewMembershipType = ResolvedChatRequest['membershipType'];
type SharedPromptContextBuilder = typeof buildChatPromptContext;

const PREVIEW_TEXT_LIMIT = 500;

export interface PreviewRequestBody {
    model?: unknown;
    reasoning?: unknown;
    mangpaiMode?: boolean;
    dreamMode?: unknown;
    difyContext?: DifyContext;
    mentions?: unknown;
    messages?: unknown;
    userMessage?: unknown;
    expressionStyle?: unknown;
    customInstructions?: unknown;
    userProfile?: unknown;
    visualizationSettings?: unknown;
}

export type PreviewContextResult = {
    diagnostics: Array<{ id: string; included: boolean; tokens: number; truncated: boolean }>;
    totalTokens: number;
    budgetTotal: number;
    userMessageTokens: number;
    historyTokens: number;
    contextTotal: number;
    remainingContext: number;
    promptKnowledgeBases: Array<{ id: string; name: string }>;
    preview: string;
};

type PreviewBuilderOptions = {
    auth: PreviewAuthContext;
    body: PreviewRequestBody;
    requestedModelId: string;
    reasoningEnabled: boolean;
    membershipType: PreviewMembershipType;
    knowledgeBaseFeatureEnabled: boolean;
    sharedPromptContextBuilder: SharedPromptContextBuilder;
};

function getMessagePayload(messages: unknown): ChatMessage[] {
    return Array.isArray(messages) ? messages as ChatMessage[] : [];
}

function getRequestMentions(mentions: unknown): Mention[] {
    if (!Array.isArray(mentions)) {
        return [];
    }

    return mentions.filter((entry): entry is Mention => {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        const item = entry as { type?: unknown; name?: unknown };
        return typeof item.type === 'string' && typeof item.name === 'string';
    });
}

function applyPreviewUserMessage(messages: ChatMessage[], userMessage: unknown): ChatMessage[] {
    if (typeof userMessage !== 'string') {
        return messages;
    }

    const nextMessages = [...messages];
    const lastMessage = nextMessages[nextMessages.length - 1];
    if (lastMessage?.role === 'user') {
        nextMessages[nextMessages.length - 1] = { ...lastMessage, content: userMessage };
        return nextMessages;
    }

    nextMessages.push({
        id: `preview-user-${nextMessages.length + 1}`,
        role: 'user',
        content: userMessage,
        createdAt: new Date().toISOString(),
    });
    return nextMessages;
}

function buildPreviewChatBody(
    body: PreviewRequestBody,
    requestedModelId: string,
    reasoningEnabled: boolean,
): ChatRequestBody {
    return {
        messages: applyPreviewUserMessage(getMessagePayload(body.messages), body.userMessage),
        mangpaiMode: body.mangpaiMode,
        dreamMode: body.dreamMode === true,
        difyContext: body.difyContext,
        mentions: getRequestMentions(body.mentions),
        model: requestedModelId,
        reasoning: reasoningEnabled,
        expressionStyle: body.expressionStyle === 'gentle'
            ? 'gentle'
            : body.expressionStyle === 'direct'
                ? 'direct'
                : undefined,
        customInstructions: body.customInstructions === null
            ? null
            : typeof body.customInstructions === 'string'
                ? body.customInstructions
                : undefined,
        userProfile: normalizeIdentityUserProfile(body.userProfile),
        visualizationSettings: normalizeVisualizationSettings(body.visualizationSettings),
    };
}

async function buildSharedPreviewContext({
    auth,
    body,
    requestedModelId,
    reasoningEnabled,
    membershipType,
    knowledgeBaseFeatureEnabled,
    sharedPromptContextBuilder,
}: PreviewBuilderOptions): Promise<PreviewContextResult> {
  const chatBody = buildPreviewChatBody(body, requestedModelId, reasoningEnabled);

  const sharedContext = await sharedPromptContextBuilder({
        body: {
            ...chatBody,
        },
        userId: auth.user.id,
        canSkipCredit: false,
        requestedModelId,
        membershipType,
        reasoningEnabled,
        creditDeducted: false,
    });

  const previewText = sharedContext.systemPrompt.slice(0, PREVIEW_TEXT_LIMIT);
  const historyTokens = countMessageTokens(chatBody.messages as Array<{ content?: string }>);
  const contextTotal = resolveModelContextConfig(requestedModelId, reasoningEnabled).maxContext;

  return {
        diagnostics: sharedContext.metadata.promptDiagnostics.layers as Array<{ id: string; included: boolean; tokens: number; truncated: boolean }>,
        totalTokens: sharedContext.metadata.promptDiagnostics.totalTokens,
        budgetTotal: sharedContext.metadata.promptDiagnostics.budgetTotal,
        userMessageTokens: sharedContext.metadata.promptDiagnostics.userMessageTokens,
        historyTokens,
        contextTotal,
        remainingContext: Math.max(0, contextTotal - historyTokens),
        promptKnowledgeBases: knowledgeBaseFeatureEnabled && membershipType !== 'free' ? sharedContext.promptKnowledgeBases : [],
        preview: sharedContext.systemPrompt.length > PREVIEW_TEXT_LIMIT ? `${previewText}...` : previewText,
  };
}

export async function buildPreviewPromptContext(options: PreviewBuilderOptions): Promise<PreviewContextResult> {
    return await buildSharedPreviewContext(options);
}
