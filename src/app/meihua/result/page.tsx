/**
 * 梅花易数结果页
 *
 * 标题区以体用关系为题（所问 · 起卦方式 · 时间），桌面端右侧为更多 · 保存 · 问太卜解卦；
 * 干支月令条、本互变三卦、体用推演，底部为解读入口与页内 AI 解读。
 * 'use client'：结果来自 sessionStorage，含自动保存与 AI 流式解读等交互状态。
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, Copy, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { CanonicalAIEntryCard, CanonicalAIPanel, useCanonicalAI } from '@/components/divination/CanonicalAISection';
import { ResultHeaderActions } from '@/components/divination/ResultHeaderActions';
import { useHeaderMenu, useHeaderTitle, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { MeihuaChart } from '@/components/meihua/MeihuaChart';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { readSessionJSON, updateSessionJSON } from '@/lib/cache/session-storage';
import { requestBrowserJson } from '@/lib/browser-api';
import { buildMeihuaCanonicalText, type MeihuaOutput, type MeihuaWebBundle } from '@/lib/divination/meihua';
import { saveDivinationAction } from '@/lib/divination/save-client';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';

type MeihuaSession = {
  input?: MeihuaWebBundle['input'];
  resultData?: MeihuaWebBundle;
  divinationId?: string;
  conversationId?: string;
};

const MENU_ICON_CLASS = 'h-4 w-4';

/** 体用关系标题：把体卦/用卦的卦名五行代入关系，如「用乾金克体巽木」。 */
const RELATION_TITLE: Record<MeihuaOutput['bodyUseRelation']['relation'], (body: string, use: string) => string> = {
  用克体: (body, use) => `用${use}克体${body}`,
  体克用: (body, use) => `体${body}克用${use}`,
  用生体: (body, use) => `用${use}生体${body}`,
  体生用: (body, use) => `体${body}生用${use}`,
  比和: (body, use) => `体${body}用${use}比和`,
};

/** `YYYY-MM-DDTHH:mm[:ss]` → `YYYY-MM-DD HH:mm`（仅展示，不做时区换算）。 */
function formatWallClock(value: string | undefined): string {
  return value ? value.replace('T', ' ').slice(0, 16) : '';
}

export default function MeihuaResultPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { setMenuItems, clearMenuItems } = useHeaderMenu();
  const { userId, sessionLoading } = useSessionMembership();
  const [bundle, setBundle] = useState<MeihuaWebBundle | null>(null);
  const [divinationId, setDivinationId] = useState<string>();
  const [conversationId, setConversationId] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAutoSavedRef = useRef(false);
  const aiAnchorRef = useRef<HTMLDivElement>(null);

  const canonicalJson = useMemo(() => bundle?.canonicalJson ?? null, [bundle]);
  const { isAdmin, jsonCopied, copyJson } = useAdminJsonCopy(canonicalJson);

  const persistSessionIds = useCallback((next: { divinationId?: string; conversationId?: string }) => {
    updateSessionJSON<MeihuaSession>('meihua_result', (previous) => ({ ...(previous || {}), ...next }));
  }, []);

  const handleConversationId = useCallback((id: string) => {
    setConversationId(id);
    persistSessionIds({ conversationId: id });
  }, [persistSessionIds]);

  const ai = useCanonicalAI({
    endpoint: '/api/meihua',
    resultData: bundle,
    recordId: divinationId,
    conversationId,
    historyType: 'meihua',
    sessionKey: 'meihua_result',
    onConversationId: handleConversationId,
  });

  const saveRecord = useCallback(async (nextBundle: MeihuaWebBundle) => {
    setSaving(true);
    try {
      const saved = await saveDivinationAction({
        endpoint: '/api/meihua',
        body: { input: nextBundle.input, resultData: nextBundle },
        idKey: 'divinationId',
        fallbackMessage: '保存梅花记录失败',
      });
      if (saved.ok && saved.id) {
        setDivinationId(saved.id);
        persistSessionIds({ divinationId: saved.id });
        return saved.id;
      }
      if (!saved.ok) console.error('[meihua/result] 保存失败:', saved.error.message);
      return undefined;
    } finally {
      setSaving(false);
    }
  }, [persistSessionIds]);

  useEffect(() => {
    if (sessionLoading) return;
    let cancelled = false;
    const init = async () => {
      const session = readSessionJSON<MeihuaSession>('meihua_result');
      if (!session?.resultData && !session?.input) {
        router.replace('/meihua');
        return;
      }
      try {
        let nextBundle = session.resultData;
        if (!nextBundle && session.input) {
          const response = await requestBrowserJson<MeihuaWebBundle>('/api/meihua', {
            method: 'POST',
            body: JSON.stringify({ action: 'calculate', input: session.input }),
          });
          if (response.error || !response.data) throw new Error(response.error?.message || '排盘失败');
          nextBundle = response.data;
        }
        if (cancelled || !nextBundle) return;
        setBundle(nextBundle);
        if (session.divinationId) setDivinationId(session.divinationId);
        if (session.conversationId) setConversationId(session.conversationId);
        // 登录用户自动保存；不阻塞盘面展示，进度体现在「保存」按钮上
        if (!session.divinationId && userId && !hasAutoSavedRef.current) {
          hasAutoSavedRef.current = true;
          void saveRecord(nextBundle);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '排盘失败');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void init();
    return () => { cancelled = true; };
  }, [router, saveRecord, sessionLoading, userId]);

  const handleCopy = useCallback(async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(buildMeihuaCanonicalText(bundle.result));
      setCopied(true);
      showToast('success', '卦象文本已复制');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('error', '复制失败，请重试');
    }
  }, [bundle, showToast]);

  // 次要操作：桌面端收进标题区「更多」，移动端进顶栏三点菜单（另加重新起卦）
  const resultActions = useMemo((): HeaderMenuItem[] => {
    if (!bundle) return [];
    const items: HeaderMenuItem[] = [
      { id: 'copy', label: copied ? '卦象已复制' : '复制卦象', icon: copied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => { void handleCopy(); } },
    ];
    if (isAdmin) items.push({ id: 'copy-json', label: jsonCopied ? 'JSON 已复制' : '复制 JSON', icon: jsonCopied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => { void copyJson(); } });
    return items;
  }, [bundle, copied, copyJson, handleCopy, isAdmin, jsonCopied]);

  useEffect(() => {
    setMenuItems([{ id: 'restart', label: '重新起卦', icon: <RotateCcw className={MENU_ICON_CLASS} />, onClick: () => router.push('/meihua') }, ...resultActions]);
    return () => clearMenuItems();
  }, [clearMenuItems, resultActions, router, setMenuItems]);

  const board = bundle?.canonicalJson.卦盘;
  useHeaderTitle(board ? `${board.本卦.卦名} 之 ${board.变卦.卦名}` : null);

  /** 保存：未登录先登录（登录后页面自动保存），已登录则手动重试保存。 */
  const handleSave = async () => {
    if (!bundle || divinationId || saving || sessionLoading) return;
    if (!userId) {
      ai.requestLogin();
      return;
    }
    hasAutoSavedRef.current = true;
    const savedId = await saveRecord(bundle);
    showToast(savedId ? 'success' : 'error', savedId ? '已保存到命理记录' : '保存失败，请重试');
  };

  /** 问太卜解卦：定位到页内解读；尚未解读时直接发起（未登录先登录）。 */
  const handleAsk = () => {
    aiAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (ai.content || ai.isStreaming) return;
    ai.start();
  };

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><SoundWaveLoader variant="block" text="正在排盘" /></div>;
  if (!bundle) return <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-5"><p className="text-sm text-foreground-secondary">{error || '没有找到排盘数据'}</p><button type="button" onClick={() => router.push('/meihua')} className="h-10 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-4 text-sm hover:bg-background-secondary">返回</button></div>;

  const result = bundle.result;
  const relationTitle = RELATION_TITLE[result.bodyUseRelation.relation](
    `${result.bodyTrigram.name}${result.bodyTrigram.element}`,
    `${result.useTrigram.name}${result.useTrigram.element}`,
  );
  const castTime = formatWallClock(bundle.input.date);
  const saveState = {
    saving,
    saved: Boolean(divinationId),
    disabled: saving || Boolean(divinationId) || sessionLoading,
    onSave: () => { void handleSave(); },
  };
  const askDisabled = ai.pending || ai.isStreaming;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1104px] animate-fade-in flex-col gap-3 px-4 pt-0.5 pb-28 sm:px-8 lg:gap-6 lg:pt-8 lg:pb-16">
        <Link href="/meihua" className="hidden w-fit items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex">
          <ChevronLeft className="h-4 w-4" />重新起卦
        </Link>

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex w-full min-w-0 flex-col items-center gap-4 lg:w-auto lg:items-start lg:gap-2">
            <p className="px-1 text-center text-[0.8125rem] leading-normal text-foreground-secondary lg:px-0 lg:text-left lg:text-sm">
              {result.question && <>问：{result.question}<br className="lg:hidden" /><span className="hidden lg:inline"> · </span></>}
              {result.castMeta.methodLabel}{castTime && ` · ${castTime}`}
            </p>
            {/* 移动端标题位于顶栏（本卦 之 变卦），体用关系改为标签 */}
            <h1 className="hidden font-display text-[2.125rem] font-normal leading-tight lg:block">{relationTitle}</h1>
            <span className={`rounded-md px-2 py-0.5 text-[0.8125rem] lg:hidden ${result.bodyUseRelation.favorable ? 'bg-wood-soft text-success' : 'bg-fire-soft text-danger'}`}>{relationTitle}</span>
          </div>
          <ResultHeaderActions actions={resultActions} actionsLabel="卦盘操作" save={saveState} ask={{ label: '问太卜解卦', onClick: handleAsk, disabled: askDisabled }} />
        </header>

        <MeihuaChart chart={bundle.canonicalJson} showDerived={false} />

        <div ref={aiAnchorRef} className="flex scroll-mt-20 flex-col empty:hidden">
          <CanonicalAIEntryCard ai={ai} title="外应、方位与应期线索" description="让太卜结合体用生克与月令旺衰，给出定性判断" actionLabel="开始解读" />
          <CanonicalAIPanel ai={ai} />
        </div>
      </div>

      <ResultMobileActions saving={saving} saved={Boolean(divinationId)} saveDisabled={sessionLoading} onSave={saveState.onSave} ask={{ label: '问太卜解卦', onClick: handleAsk, disabled: askDisabled }} />
    </div>
  );
}
