/**
 * 小六壬结果页
 *
 * 桌面端：标题区（更多操作）+ 起课表单（原地重新起课），左栏掌诀推演，右栏最终落宫与掐数明细；
 * 移动端：起课摘要卡（重新起课回入口页），保存与问太卜在底部操作栏；解读统一进入 AI 对话。
 * 'use client'：结果来自 sessionStorage，含自动保存与原地换课等交互状态。
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, RotateCcw, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { LUNAR_DAY_NAMES, LUNAR_MONTH_NAMES } from '@/components/bazi/form/options';
import { ResultMobileActions } from '@/components/bazi/result/ResultHeader';
import { ResultMoreActions } from '@/components/divination/ResultMoreActions';
import { useHeaderMenu, type HeaderMenuItem } from '@/components/layout/HeaderMenuContext';
import { XiaoliurenChart } from '@/components/xiaoliuren/XiaoliurenChart';
import { XiaoliurenForm } from '@/components/xiaoliuren/XiaoliurenForm';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAdminJsonCopy } from '@/lib/admin/useAdminJsonCopy';
import { readSessionJSON, scopeResultSession, updateSessionJSON, writeSessionJSON } from '@/lib/cache/session-storage';
import { useResultIdentity } from '@/lib/hooks/useIdentityGuard';
import { buildXiaoliurenCanonicalText, type XiaoliurenWebBundle } from '@/lib/divination/xiaoliuren';
import { saveDivinationAction } from '@/lib/divination/save-client';
import { useSessionBalance } from '@/lib/hooks/useSessionBalance';
import { AuthModal } from '@/components/auth/AuthModal';
import { openChatWithResult } from '@/lib/chat/result-handoff';

type XiaoliurenSession = { resultData?: XiaoliurenWebBundle; divinationId?: string; recordOwnerId?: string | null };
type LoadedSession = XiaoliurenSession & { resultData: XiaoliurenWebBundle };

const SESSION_KEY = 'xiaoliuren_result';
const ASK_LABEL = '让太卜结合所问解读';
const MENU_ICON_CLASS = 'h-4 w-4';

/** `YYYY-MM-DDTHH:mm:ss` → `YYYY-MM-DD HH:mm`（仅展示，不做时区换算）。 */
function formatWallClock(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}

function formatLunarDate(bundle: XiaoliurenWebBundle): string {
  const month = bundle.lunarMonthName
    ? `${bundle.lunarMonthName}月`
    : `${bundle.isLeapMonth ? '闰' : ''}${LUNAR_MONTH_NAMES[bundle.lunarMonth] ?? `${bundle.lunarMonth}月`}`;
  const day = bundle.lunarDayName ?? LUNAR_DAY_NAMES[bundle.lunarDay] ?? `${bundle.lunarDay}日`;
  return `农历${month}${day}`;
}

export default function XiaoliurenResultPage() {
  const identity = useResultIdentity();
  const router = useRouter();
  const [loaded, setLoaded] = useState<{ generation: number; session: LoadedSession } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      await Promise.resolve();
      if (cancelled) return;
      const session = readSessionJSON<XiaoliurenSession>(SESSION_KEY);
      if (!session?.resultData) {
        router.replace('/xiaoliuren');
        return;
      }
      setLoaded({ generation: 0, session: { ...session, resultData: session.resultData } });
    };
    void init();
    return () => { cancelled = true; };
  }, [router]);

  /** 桌面端表单原地换课：覆盖会话并以新 key 重挂结果视图，保存与 AI 解读状态随之归零。 */
  const handleRecalculated = useCallback((bundle: XiaoliurenWebBundle) => {
    writeSessionJSON<XiaoliurenSession>(SESSION_KEY, { resultData: bundle });
    setLoaded((previous) => ({ generation: (previous?.generation ?? 0) + 1, session: { resultData: bundle } }));
  }, []);

  if (!loaded) return <div className="flex min-h-screen items-center justify-center bg-background"><SoundWaveLoader variant="block" text="正在排课" /></div>;
  return <XiaoliurenResultView key={`${loaded.generation}:${identity.key}`} session={loaded.session} onRecalculated={handleRecalculated} isCurrent={identity.isCurrent} />;
}

function XiaoliurenResultView({ session: storedSession, onRecalculated, isCurrent }: { session: LoadedSession; onRecalculated: (bundle: XiaoliurenWebBundle) => void; isCurrent: () => boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { setMenuItems, clearMenuItems } = useHeaderMenu();
  const { userId, sessionLoading } = useSessionBalance();
  const session = scopeResultSession(storedSession, userId);
  const bundle = session.resultData;
  const result = bundle.result;
  const [divinationId, setDivinationId] = useState(session.divinationId);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const hasAutoSavedRef = useRef(false);
  const { isAdmin, jsonCopied, copyJson } = useAdminJsonCopy(bundle.canonicalJson);

  /** 只回写仍属于本课的会话：原地换课后，旧课迟到的记录 / 会话 id 不能串到新课上。 */
  const persistSessionIds = useCallback((next: { divinationId?: string }) => {
    if (!isCurrent()) return;
    updateSessionJSON<XiaoliurenSession>(SESSION_KEY, (previous) => {
      if (previous?.resultData && previous.resultData.canonicalText !== bundle.canonicalText) return previous;
      return { ...scopeResultSession(previous || {}, userId), ...next, recordOwnerId: userId };
    });
  }, [bundle.canonicalText, isCurrent, userId]);

  const saveRecord = useCallback(async () => {
    setSaving(true);
    try {
      const saved = await saveDivinationAction({ endpoint: '/api/xiaoliuren', body: { resultData: bundle }, idKey: 'divinationId', fallbackMessage: '保存小六壬记录失败' });
      if (!isCurrent()) return undefined;
      if (saved.ok && saved.id) {
        setDivinationId(saved.id);
        persistSessionIds({ divinationId: saved.id });
        return saved.id;
      }
      if (!saved.ok) console.error('[xiaoliuren/result] 保存失败:', saved.error.message);
      return undefined;
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }, [bundle, persistSessionIds, isCurrent]);

  // 登录用户自动保存；不阻塞盘面展示，进度体现在「保存」上
  useEffect(() => {
    if (sessionLoading || !userId || divinationId || hasAutoSavedRef.current) return;
    hasAutoSavedRef.current = true;
    const run = async () => {
      await Promise.resolve();
      await saveRecord();
    };
    void run();
  }, [divinationId, saveRecord, sessionLoading, userId]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildXiaoliurenCanonicalText(bundle.result));
      setCopied(true);
      showToast('success', '课盘文本已复制');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('error', '复制失败，请重试');
    }
  }, [bundle.result, showToast]);

  /** 保存：未登录先登录（登录后自动保存），已登录则手动重试。 */
  const handleSave = async () => {
    if (divinationId || saving || sessionLoading) return;
    if (!userId) {
      setShowAuthModal(true);
      return;
    }
    hasAutoSavedRef.current = true;
    const savedId = await saveRecord();
    if (!isCurrent()) return;
    showToast(savedId ? 'success' : 'error', savedId ? '已保存到命理记录' : '保存失败，请重试');
  };

  /** 让太卜解读：进入 AI 对话，已保存的课盘会用 mention 一起带过去。 */
  const handleAsk = () => {
    const question = result.question?.trim();
    openChatWithResult(router, {
      text: `${question ? `我问的是「${question}」。` : ''}请结合这次小六壬课盘，解读落宫、掐数过程与应期。`,
      mentions: divinationId ? [{
        type: 'xiaoliuren_divination',
        id: divinationId,
        name: `小六壬 · ${result.result.name} · ${result.input.shichen}`,
        preview: question || `${result.result.name}（${result.result.nature}）`,
      }] : [],
    });
  };

  // 次要操作：桌面端收进标题区「更多」（另含保存，桌面端无底部操作栏），移动端进顶栏三点菜单（另含重新起课）
  const copyActions = useMemo((): HeaderMenuItem[] => {
    const items: HeaderMenuItem[] = [
      { id: 'copy', label: copied ? '课盘已复制' : '复制课盘', icon: copied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => { void handleCopy(); } },
    ];
    if (isAdmin) items.push({ id: 'copy-json', label: jsonCopied ? 'JSON 已复制' : '复制 JSON', icon: jsonCopied ? <Check className={MENU_ICON_CLASS} /> : <Copy className={MENU_ICON_CLASS} />, onClick: () => { void copyJson(); } });
    return items;
  }, [copied, copyJson, handleCopy, isAdmin, jsonCopied]);

  const saved = Boolean(divinationId);
  const desktopActions: HeaderMenuItem[] = [
    ...copyActions,
    { id: 'save', label: saved ? '已保存' : saving ? '保存中' : '保存课盘', icon: saved ? <Check className={MENU_ICON_CLASS} /> : <Save className={MENU_ICON_CLASS} />, onClick: () => { void handleSave(); }, disabled: saved || saving || sessionLoading },
  ];

  useEffect(() => {
    setMenuItems([{ id: 'restart', label: '重新起课', icon: <RotateCcw className={MENU_ICON_CLASS} />, onClick: () => router.push('/xiaoliuren') }, ...copyActions]);
    return () => clearMenuItems();
  }, [clearMenuItems, copyActions, router, setMenuItems]);

  const askAction = (
    <div className="hidden items-center gap-2 lg:flex">
      <Button unstyled
        type="button"
        onClick={handleAsk}
        className="h-[46px] min-w-0 flex-1 rounded-xl bg-foreground px-4 text-sm text-background transition-opacity hover:opacity-90"
      >
        {ASK_LABEL}
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1024px] motion-stagger flex-col gap-3 px-4 pt-4 pb-28 sm:px-8 lg:gap-7 lg:pt-12 lg:pb-16">
        <header className="hidden items-end justify-between gap-4 lg:flex">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="font-display text-[2rem] font-normal leading-tight">小六壬</h1>
            <p className="text-[15px] text-foreground-secondary">以左手食、中、无名三指六节为六宫，按农历月、日、时三步掐数落宫。</p>
          </div>
          <ResultMoreActions actions={desktopActions} label="课盘操作" />
        </header>

        <XiaoliurenForm
          displayClassName="hidden lg:flex"
          initialQuestion={result.question}
          initialDate={bundle.solarDateTime.slice(0, 16)}
          submitLabel="重新起课"
          onCalculated={onRecalculated}
        />

        <section aria-label="起课信息" className="flex items-center gap-3 rounded-2xl border-[0.5px] border-border bg-surface px-3.5 py-3 lg:hidden">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="truncate text-sm font-normal">{result.question || '未填写占问'}</h2>
            <p className="text-xs text-foreground-secondary">{formatWallClock(bundle.solarDateTime)} · {formatLunarDate(bundle)} {result.input.shichen}</p>
          </div>
          <Button unstyled
            type="button"
            onClick={() => router.push('/xiaoliuren')}
            className="h-[34px] shrink-0 rounded-[9px] border-[0.5px] border-border-hover bg-surface px-3 text-[13px] text-foreground transition-colors hover:bg-background-secondary"
          >
            重新起课
          </Button>
        </section>

        <XiaoliurenChart chart={bundle.canonicalJson} action={askAction} />

      </div>

      <ResultMobileActions
        saving={saving}
        saved={saved}
        saveDisabled={sessionLoading}
        onSave={() => { void handleSave(); }}
        ask={{ label: ASK_LABEL, onClick: handleAsk }}
      />
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
}
