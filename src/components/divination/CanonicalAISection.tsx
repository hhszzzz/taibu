'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Brain, RefreshCw, Sparkles } from 'lucide-react';
import { AuthModal } from '@/components/auth/AuthModal';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { CreditsModal } from '@/components/ui/CreditsModal';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { runSharedAnalysisFlow } from '@/lib/ai/analysis-runner';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { isCreditsError, useStreamingResponse } from '@/lib/hooks/useStreamingResponse';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import type { HistoryType } from '@/lib/history/registry';

type CanonicalAISectionProps = {
  endpoint: string;
  resultData: unknown;
  recordId?: string;
  conversationId?: string;
  historyType: HistoryType;
  sessionKey: string;
  onConversationId: (conversationId: string) => void;
};

export interface CanonicalAIController {
  /** AI 开关已解析且开启；未解析或关闭时一律不展示入口（fail-closed）。 */
  enabled: boolean;
  /** 会话或会员信息仍在加载，入口应暂不可点。 */
  pending: boolean;
  isLoggedIn: boolean;
  isStreaming: boolean;
  content: string | null;
  reasoning: string | null;
  error: string | null;
  /** 登录用户开始解读；未登录时打开登录弹窗。 */
  start: () => void;
  requestLogin: () => void;
  modelSelector: ReactNode;
  /** 登录 / 积分弹窗，必须始终渲染一次。 */
  modals: ReactNode;
  /** 内部使用：区分已落定的解读与流式中的内容。 */
  interpretation: string | null;
}

/**
 * Canonical divination result pages share one AI interaction state. Pages can
 * place several entry buttons (header, CTA card, mobile bar) and one output
 * panel; the feature state stays fail-closed while the AI switch is unresolved.
 */
export function useCanonicalAI({
  endpoint,
  resultData,
  recordId,
  conversationId,
  historyType,
  sessionKey,
  onConversationId,
}: CanonicalAISectionProps): CanonicalAIController {
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [interpretationReasoning, setInterpretationReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const streaming = useStreamingResponse();
  const { userId, membershipInfo, sessionLoading, membershipLoading, membershipResolved } = useSessionMembership();
  const { isFeatureEnabled, loaded: featureLoaded } = useFeatureToggles();
  const aiEnabled = featureLoaded && isFeatureEnabled('chat');
  const membershipPending = membershipLoading || !membershipResolved;
  const membershipType = membershipResolved ? (membershipInfo?.type ?? 'free') : 'free';

  const snapshotCallbacks = useMemo(() => ({
    onAnalysis: setInterpretation,
    onReasoning: setInterpretationReasoning,
    onReasoningEnabled: setReasoningEnabled,
    onModelId: setModelId,
    onConversationIdResolved: onConversationId,
  }), [onConversationId]);

  useAnalysisSnapshot({
    conversationId,
    recordId,
    divinationType: historyType,
    sessionKey,
    hasExistingAnalysis: Boolean(interpretation || streaming.content),
    skip: !aiEnabled || (!conversationId && !recordId),
    callbacks: snapshotCallbacks,
  });

  const handleInterpret = useCallback(async () => {
    if (!aiEnabled) return;
    if (!userId) {
      setShowAuthModal(true);
      return;
    }

    setError(null);
    setInterpretation(null);
    setInterpretationReasoning(null);
    streaming.reset();

    try {
      const analysisResult = await runSharedAnalysisFlow({
        endpoint,
        streaming,
        isCreditsError,
        direct: {
          prepareBody: { action: 'interpret_prepare', resultData, divinationId: recordId },
          persistBody: { action: 'interpret_persist', resultData, divinationId: recordId },
        },
        streamBody: {
          action: 'interpret',
          resultData,
          divinationId: recordId,
          modelId,
          reasoning: reasoningEnabled,
          stream: true,
        },
      });

      if (analysisResult.requiresCredits) {
        setShowCreditsModal(true);
        return;
      }
      if (analysisResult.error) {
        setError(analysisResult.error === 'FEATURE_DISABLED'
          ? 'AI 功能当前未启用'
          : analysisResult.error);
      }
      if (analysisResult.content) setInterpretation(analysisResult.content);
      if (analysisResult.reasoning) setInterpretationReasoning(analysisResult.reasoning);
      if (analysisResult.conversationId) onConversationId(analysisResult.conversationId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '解读失败');
    }
  }, [aiEnabled, endpoint, modelId, onConversationId, reasoningEnabled, recordId, resultData, streaming, userId]);

  const start = useCallback(() => {
    if (sessionLoading) return;
    if (!userId) {
      setShowAuthModal(true);
      return;
    }
    if (streaming.isStreaming || membershipPending) return;
    void handleInterpret();
  }, [handleInterpret, membershipPending, sessionLoading, streaming.isStreaming, userId]);

  return {
    enabled: aiEnabled,
    pending: sessionLoading || (Boolean(userId) && membershipPending),
    isLoggedIn: Boolean(userId),
    isStreaming: streaming.isStreaming,
    content: interpretation || streaming.content || null,
    reasoning: interpretationReasoning || streaming.reasoning || null,
    error,
    interpretation,
    start,
    requestLogin: () => setShowAuthModal(true),
    modelSelector: (
      <ModelSelector
        compact
        selectedModel={modelId}
        onModelChange={setModelId}
        reasoningEnabled={reasoningEnabled}
        onReasoningChange={setReasoningEnabled}
        userId={userId}
        membershipType={membershipType}
        disabled={membershipPending}
      />
    ),
    modals: (
      <>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
      </>
    ),
  };
}

/** 解读输出面板：仅在已有内容、流式中或出错时出现；弹窗始终挂载。 */
export function CanonicalAIPanel({ ai, title = 'AI 深度解读' }: { ai: CanonicalAIController; title?: string }) {
  const visible = ai.enabled && Boolean(ai.content || ai.error || ai.isStreaming);
  return (
    <>
      {visible && (
        <section aria-label={title} className="flex flex-col gap-4 rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-lg font-normal">
              <Brain className="h-4 w-4 text-accent" />
              {title}
            </h2>
            <div className="flex items-center gap-2">
              {ai.modelSelector}
              {ai.content && (
                <button
                  type="button"
                  aria-label="重新获取 AI 解读"
                  title="重新获取 AI 解读"
                  onClick={ai.start}
                  disabled={ai.isStreaming}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-foreground-secondary transition-colors hover:bg-background-secondary active:bg-background-tertiary disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${ai.isStreaming ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </div>

          {ai.error && <div className="rounded-[10px] bg-fire-soft px-3 py-2.5 text-xs text-danger">{ai.error}</div>}

          {ai.content ? (
            <div className="prose prose-sm max-w-none">
              {ai.reasoning && <ThinkingBlock content={ai.reasoning} isStreaming={ai.isStreaming && !ai.interpretation} />}
              <MarkdownContent content={ai.content} className="text-sm leading-relaxed text-foreground" />
            </div>
          ) : ai.isStreaming ? (
            <SoundWaveLoader variant="inline" />
          ) : null}
        </section>
      )}
      {ai.modals}
    </>
  );
}

interface CanonicalAIEntryCardProps {
  ai: CanonicalAIController;
  title: ReactNode;
  description: string;
  /** 登录用户的按钮文案；未登录时统一为「登录解锁 AI 解读」。 */
  actionLabel: string;
  actionIcon?: ReactNode;
}

/**
 * 解读入口卡：标题、说明、模型选择与开始按钮。仅在尚未解读时出现，解读开始后由 CanonicalAIPanel 接替；
 * 不渲染弹窗，页面需另行挂载 CanonicalAIPanel（或 ai.modals）。
 */
export function CanonicalAIEntryCard({ ai, title, description, actionLabel, actionIcon }: CanonicalAIEntryCardProps) {
  if (!ai.enabled || ai.content || ai.error || ai.isStreaming) return null;
  return (
    <section aria-label="AI 解读入口" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border-[0.5px] border-border bg-panel px-5 py-[18px] sm:px-[22px]">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-[17px] font-normal">{title}</h2>
        <p className="text-sm text-foreground-secondary">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {ai.modelSelector}
        <button
          type="button"
          onClick={ai.start}
          disabled={ai.pending}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-foreground px-4 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {actionIcon}
          {ai.isLoggedIn ? actionLabel : '登录解锁 AI 解读'}
        </button>
      </div>
    </section>
  );
}

/** 一体化默认形态：入口卡与输出面板共用一处位置。 */
export function CanonicalAISection(props: CanonicalAISectionProps) {
  const ai = useCanonicalAI(props);
  return (
    <>
      <CanonicalAIEntryCard
        ai={ai}
        title={<><Brain className="h-4 w-4 text-accent" />AI 深度解读</>}
        description="让太卜结合所问与盘面，给出定性判断与建议"
        actionLabel="获取 AI 解读"
        actionIcon={<Sparkles className="h-4 w-4" />}
      />
      <CanonicalAIPanel ai={ai} />
    </>
  );
}
