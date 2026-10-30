/**
 * AI 对话页面 — 薄编排层
 *
 * 'use client' 标记说明：
 * - 页面包含实时对话交互，需要在客户端运行
 */
'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AuthModal } from '@/components/auth/AuthModal';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useAppBootstrap } from '@/lib/hooks/useAppBootstrap';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useChatBootstrap } from '@/lib/chat/use-chat-bootstrap';
import { useChatState } from '@/lib/chat/use-chat-state';
import { useChatMessaging } from '@/lib/chat/use-chat-messaging';
import { ChatLayout } from '@/components/chat/ChatLayout';
import { MobileChatDrawer } from '@/components/chat/MobileChatDrawer';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { StatePanel, STATE_SECONDARY_ACTION_CLASS } from '@/components/ui/StatePanel';

export default function ChatPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const { isFeatureEnabled } = useFeatureToggles();
    const { user, loading: sessionLoading } = useSessionSafe();
    const appBootstrap = useAppBootstrap({ enabled: !sessionLoading });
    const knowledgeBaseEnabled = isFeatureEnabled('knowledge-base');

    const {
        promptKnowledgeBases,
        bootstrapLoading: promptKnowledgeBasesLoading,
        bootstrapError,
        hasBootstrapData,
        refreshBootstrap,
    } = useChatBootstrap({ user, sessionLoading, knowledgeBaseEnabled });
    const userId = user?.id ?? null;
    const viewerStateErrorMessage = appBootstrap.viewerStateError?.message ?? null;
    const membership = appBootstrap.viewerStateLoaded ? appBootstrap.data.membership : null;
    const credits = membership?.aiChatCount ?? null;
    const bootstrapLoading = promptKnowledgeBasesLoading || appBootstrap.isLoading;
    const bootstrapErrorMessage = bootstrapError
        || viewerStateErrorMessage
        || (appBootstrap.error instanceof Error ? appBootstrap.error.message : null);
    const bootstrapLocked = Boolean(
        userId
        && !bootstrapLoading
        && (
            (bootstrapError && !hasBootstrapData)
            || !!appBootstrap.viewerStateError
            || (appBootstrap.error instanceof Error && !appBootstrap.hasBootstrapData)
        ),
    );

    const state = useChatState({ userId, sessionLoading, bootstrapLoading, router, searchParams });

    const messaging = useChatMessaging({
        state, userId, user,
        refreshViewerState: appBootstrap.refresh, markViewerCreditsExhausted: appBootstrap.markCreditsExhausted,
        showToast, router, searchParams,
    });

    const isCreditLocked = typeof credits === 'number' && credits <= 0 && !state.customProviderActive && !messaging.agent.active;
    const [showAuthModal, setShowAuthModal] = useState(false);

    if (bootstrapLocked) {
        return (
            <div className="flex min-h-[100dvh] flex-col">
                {/* Phones have no site header here: keep the navigation drawer reachable. */}
                <header className="chat-session-header is-empty"><MobileChatDrawer /></header>
                <StatePanel layout="page" titleAs="h2" tone="danger" icon={RefreshCw} className="flex-1"
                    title="加载对话上下文失败"
                    description={bootstrapErrorMessage}
                    action={<Button unstyled type="button" className={STATE_SECONDARY_ACTION_CLASS}
                        onClick={() => void Promise.all([refreshBootstrap(), appBootstrap.refresh()])}>
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />重新加载
                    </Button>} />
            </div>
        );
    }

    return (
        <>
            <ChatLayout
                activeConversationId={state.activeConversationId}
                conversationTitle={state.conversations.find(conversation => conversation.id === state.activeConversationId)?.title || state.pendingSidebarTitle || undefined}
                conversationLoading={state.conversationLoading}
                conversationError={state.conversationError}
                messages={state.messages}
                isLoading={state.isLoading || messaging.agent.running}
                isSendingToList={state.isSendingToList || messaging.agent.restoring || messaging.agent.syncing}
                messagesEndRef={state.messagesEndRef}
                messageScrollContainerRef={state.messageScrollContainerRef}
                shouldAutoScrollRef={state.shouldAutoScrollRef}
                onMessageListScroll={messaging.handleMessageListScroll}
                onEditMessage={messaging.handleEditMessage}
                onRegenerateResponse={messaging.handleRegenerateResponse}
                onSwitchVersion={messaging.handleSwitchVersion}
                onArchiveMessage={state.activeConversationId && knowledgeBaseEnabled ? messaging.handleArchiveMessage : undefined}
                onSend={messaging.handleSend}
                onImageGenerate={messaging.handleImageGenerate}
                onStop={messaging.handleStop}
                agent={messaging.agent}
                onQueueMessage={messaging.handleQueueMessage}
                onAuthRequired={!userId ? () => setShowAuthModal(true) : undefined}
                onRetryConversationLoad={state.retryConversationLoad}
                displayName={userId ? appBootstrap.data.viewerSummary?.nickname : null}
                inputValue={state.inputValue}
                onInputChange={state.setInputValue}
                disabled={isCreditLocked || bootstrapLocked}
                credits={credits}
                chatMode={state.chatMode}
                onChatModeChange={state.setChatMode}
                selectedModel={state.selectedModel}
                onModelChange={state.setSelectedModel}
                reasoningEnabled={state.reasoningEnabled}
                onReasoningChange={state.setReasoningEnabled}
                reasoningEffort={state.reasoningEffort}
                onReasoningEffortChange={state.setReasoningEffort}
                collaborators={state.collaborators}
                onCollaboratorsChange={state.setCollaborators}
                customProviderActive={state.customProviderActive}
                customProviderLabel={state.customProviderLabel}
                userId={userId}
                membershipType={membership?.type ?? 'free'}
                attachmentState={state.attachmentState}
                onAttachmentChange={state.setAttachmentState}
                mentions={state.mentions}
                onMentionsChange={state.setMentions}
                promptKnowledgeBases={promptKnowledgeBases}
                dreamContext={state.dreamContext}
                dreamContextLoading={state.dreamContextLoading}
                knowledgeBaseEnabled={knowledgeBaseEnabled}
                isCreditLocked={isCreditLocked}
            >
                {state.kbTargetMessage && state.activeConversationId && isFeatureEnabled('knowledge-base') && (
                    <AddToKnowledgeBaseModal
                        open={state.kbModalOpen}
                        onClose={messaging.closeKbModal}
                        sourceTitle={state.kbTargetMessage.content.slice(0, 40) || '对话回复'}
                        sourceType="chat_message"
                        sourceId={state.kbTargetMessage.id}
                        sourceMeta={{ conversationId: state.activeConversationId }}
                    />
                )}
            </ChatLayout>

            <CreditsModal
                isOpen={state.showCreditsModal}
                onClose={() => state.setShowCreditsModal(false)}
            />
            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
            />
        </>
    );
}
