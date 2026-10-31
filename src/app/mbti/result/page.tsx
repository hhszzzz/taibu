/**
 * MBTI 测试结果页面
 * 
 * 人格卡片与维度分析；解读统一进入 AI 对话
 */
'use client'; // 需要 sessionStorage 结果与查询参数

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RotateCw, Sparkles, ChevronLeft, BookOpenText } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Button } from '@/components/ui/Button';
import { PersonalityCard } from '@/components/mbti/PersonalityCard';
import { buildViewResult, type TestResult } from '@/lib/divination/mbti';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { readSessionJSON } from '@/lib/cache/session-storage';
import { openChatWithResult } from '@/lib/chat/result-handoff';
import { useHeaderMenu } from '@/components/layout/HeaderMenuContext';
type MBTIResultSession = TestResult & {
    readingId?: string | null;
};

function MBTIResultContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { setMenuItems, clearMenuItems } = useHeaderMenu();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const viewType = searchParams.get('type');
    const isViewMode = searchParams.get('view') === 'true';

    const [result, setResult] = useState<MBTIResultSession | null>(null);
    const [kbModalOpen, setKbModalOpen] = useState(false);

    useEffect(() => {
        void Promise.resolve().then(() => {
            const stored = readSessionJSON<MBTIResultSession>('mbti_result');
            if (stored) {
                setResult(stored);
            } else if (isViewMode && viewType) {
                const viewResult = buildViewResult(viewType.toUpperCase());
                if (viewResult) setResult(viewResult);
                else router.push('/mbti');
            } else router.push('/mbti');
        });
    }, [router, isViewMode, viewType]);

    const isTestMode = result ? (!isViewMode && result.scores && result.percentages) : false;
    const readingId = result?.readingId;

    /** 问太卜：带上已保存的 MBTI 结果进入 AI 对话。 */
    const handleAsk = () => {
        if (!result) return;
        openChatWithResult(router, {
            text: `请结合我的 MBTI 结果（${result.type}）与四个维度倾向，给出更具体的性格与成长建议。`,
            mentions: readingId ? [{
                type: 'mbti_reading',
                id: readingId,
                name: `MBTI · ${result.type}`,
                preview: result.type,
            }] : [],
        });
    };

    useEffect(() => {
        if (!result) return;
        const items = [];
        if (isTestMode) items.push({ id: 'retest', label: '重新测试', icon: <RotateCw className="w-4 h-4" />, onClick: () => router.push('/mbti/test') });
        if (knowledgeBaseEnabled && readingId) items.push({ id: 'add-to-kb', label: '收藏', icon: <BookOpenText className="w-4 h-4" />, onClick: () => setKbModalOpen(true) });
        setMenuItems(items);
        return () => clearMenuItems();
    }, [knowledgeBaseEnabled, readingId, isTestMode, result, router, setMenuItems, clearMenuItems]);

    if (!result) return (
        <div className="flex min-h-[60vh] items-center justify-center bg-background">
            <SoundWaveLoader variant="block" text="" />
        </div>
    );

    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[820px] motion-stagger flex-col gap-5 px-4 py-4 lg:gap-6 lg:px-8 lg:py-8">
                {/* 头部导航（桌面端；移动端由顶栏承载） */}
                <div className="hidden items-center justify-between lg:flex">
                    <Link href="/mbti" className="inline-flex items-center gap-1 text-sm text-foreground-secondary transition-colors hover:text-foreground"><ChevronLeft className="h-4 w-4" aria-hidden="true" />返回 MBTI 首页</Link>
                    {isTestMode && <Button unstyled type="button" onClick={() => router.push('/mbti/test')} className="inline-flex h-10 items-center gap-1.5 rounded-xl border-[0.5px] border-border-hover bg-surface px-3.5 text-sm transition-colors hover:bg-background-secondary"><RotateCw className="h-3.5 w-3.5" aria-hidden="true" />重新测试</Button>}
                </div>

                {/* 性格卡片 */}
                <PersonalityCard result={result} showDimensions={!!isTestMode} />

                {/* 解读入口：页内不再生成解读，统一进入 AI 对话 */}
                {isTestMode && (
                    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-[0.5px] border-border bg-surface px-4 py-4 lg:px-6">
                        <div className="flex min-w-0 flex-col gap-1">
                            <h2 className="inline-flex items-center gap-2 font-display text-[17px] font-medium"><Sparkles className="h-4 w-4 text-clay" aria-hidden="true" />AI 深度分析</h2>
                            <p className="text-sm text-foreground-secondary">带上你的 MBTI 结果进入 AI 对话，由太卜在对话里展开分析。</p>
                        </div>
                        <Button unstyled type="button" onClick={handleAsk} className="h-11 rounded-xl bg-accent px-6 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">问太卜</Button>
                    </section>
                )}

                {/* 底部收藏操作 */}
                {knowledgeBaseEnabled && !!readingId && (
                    <div className="flex justify-center pt-2">
                        <Button unstyled type="button" onClick={() => setKbModalOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl border-[0.5px] border-border-hover bg-surface px-5 text-sm text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"><BookOpenText className="h-4 w-4" aria-hidden="true" />收藏至知识库</Button>
                    </div>
                )}

                {/* 查看模式：开始测试按钮 */}
                {!isTestMode && (
                    <div className="flex justify-center pt-4">
                        <Link href="/mbti/test" className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-7 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"><Sparkles className="h-4 w-4" aria-hidden="true" />开始 MBTI 测试</Link>
                    </div>
                )}
            </div>

            {knowledgeBaseEnabled && readingId && <AddToKnowledgeBaseModal open={kbModalOpen} onClose={() => setKbModalOpen(false)} sourceTitle={`MBTI - ${result.type}`} sourceType="mbti_reading" sourceId={readingId} />}
        </div>
    );
}

export default function MBTIResultPage() {
    return (
        <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center bg-background"><SoundWaveLoader variant="block" /></div>}>
            <MBTIResultContent />
        </Suspense>
    );
}
