/**
 * 八字基本信息区块
 *
 * 日主特征卡片 + AI 分析入口 + 十神知识库；颜色全部来自主题 token。
 */
import type { ReactNode } from 'react';
import { User, Save, Sparkles, Info } from 'lucide-react';
import type { BaziCanonicalJSON } from 'taibu-core/bazi';
import { elementTextClass } from '@/components/bazi/element-classes';
import { TenGodKnowledge } from '@/components/bazi/TenGodKnowledge';
import { AIWuxingAnalysis } from '@/components/bazi/result/AIWuxingAnalysis';
import { AIPersonalityAnalysis } from '@/components/bazi/result/AIPersonalityAnalysis';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import type { FiveElement, TenGod } from '@/types';

const FIVE_ELEMENTS: readonly FiveElement[] = ['木', '火', '土', '金', '水'];
const ELEMENT_SOFT_BG: Record<FiveElement, string> = {
    木: 'bg-wood-soft',
    火: 'bg-fire-soft',
    土: 'bg-earth-soft',
    金: 'bg-metal-soft',
    水: 'bg-water-soft',
};

/** AI 分析不可用时的提示卡片（未知时辰 / 未保存） */
function AINoticeCard({ icon, title, subtitle, notice }: { icon: ReactNode; title: string; subtitle: string; notice: string }) {
    return (
        <section className="rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6">
            <div className="flex items-start gap-4">
                <div className="shrink-0 rounded-xl bg-panel p-2.5">{icon}</div>
                <div className="flex-1 space-y-3">
                    <div>
                        <h3 className="font-display text-lg text-foreground">{title}</h3>
                        <p className="mt-0.5 text-[13px] text-foreground-secondary">{subtitle}</p>
                    </div>
                    <div className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {notice}
                    </div>
                </div>
            </div>
        </section>
    );
}

/** 未登录时的 AI 分析入口卡片 */
function AILoginCard({ icon, title, description, onLoginRequired }: { icon: ReactNode; title: string; description: string; onLoginRequired?: () => void }) {
    return (
        <section className="space-y-4 rounded-2xl border-[0.5px] border-border bg-surface p-6 text-center sm:p-8">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">{icon}</div>
            <div className="space-y-1">
                <h3 className="font-display text-lg text-foreground">{title}</h3>
                <p className="mx-auto max-w-xs text-sm leading-relaxed text-foreground-secondary">{description}</p>
            </div>
            <button
                type="button"
                onClick={onLoginRequired}
                className="h-11 rounded-xl bg-accent px-6 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
                立即登录体验
            </button>
        </section>
    );
}

interface BasicInfoSectionProps {
    canonicalChart: BaziCanonicalJSON;
    dayMasterDescription: string;
    /** 命盘ID（用于AI分析持久化） */
    chartId?: string | null;
    /** 用户ID */
    userId?: string | null;
    /** 用户当前积分 */
    credits?: number | null;
    /** 已保存的五行分析 */
    savedWuxingAnalysis?: string | null;
    /** 已保存的五行推理 */
    savedWuxingReasoning?: string | null;
    /** 已保存的五行模型 */
    savedWuxingModelId?: string | null;
    /** 已保存的人格分析 */
    savedPersonalityAnalysis?: string | null;
    /** 已保存的人格推理 */
    savedPersonalityReasoning?: string | null;
    /** 已保存的人格模型 */
    savedPersonalityModelId?: string | null;
    /** 是否具备有效出生时辰 */
    hasKnownBirthTime?: boolean;
    /** 保存五行分析回调 */
    onSaveWuxingAnalysis?: (analysis: string) => void;
    /** 保存人格分析回调 */
    onSavePersonalityAnalysis?: (analysis: string) => void;
    /** 登录回调 */
    onLoginRequired?: () => void;
}

export function BasicInfoSection({
    canonicalChart,
    dayMasterDescription,
    chartId,
    userId,
    credits,
    savedWuxingAnalysis,
    savedWuxingReasoning,
    savedWuxingModelId,
    savedPersonalityAnalysis,
    savedPersonalityReasoning,
    savedPersonalityModelId,
    hasKnownBirthTime = true,
    onSaveWuxingAnalysis,
    onSavePersonalityAnalysis,
    onLoginRequired,
}: BasicInfoSectionProps) {
    // 获取命盘中出现的十神
    const highlightedTenGods: TenGod[] = [
        canonicalChart.四柱[0]?.天干十神,
        canonicalChart.四柱[1]?.天干十神,
        canonicalChart.四柱[3]?.天干十神,
    ].filter((g): g is TenGod => !!g);
    const dayMasterElement = canonicalChart.基本信息.命主五行?.slice(-1) || '';

    // 是否已保存命盘
    const isSaved = Boolean(chartId);
    const dayMasterKnownElement = FIVE_ELEMENTS.find((element) => element === dayMasterElement) ?? null;

    return (
        <div className="flex flex-col gap-6 animate-fade-in">
            {/* 1. 日主特征 */}
            <section className="rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6">
                <div className="mb-4 flex items-center gap-2">
                    <User className="h-4 w-4 text-foreground-tertiary" />
                    <h2 className="text-[13px] text-foreground-secondary">日主特征</h2>
                </div>
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:gap-5">
                    <div
                        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-display text-[34px] ${dayMasterKnownElement ? ELEMENT_SOFT_BG[dayMasterKnownElement] : 'bg-panel'} ${elementTextClass(dayMasterKnownElement)}`}
                    >
                        {canonicalChart.基本信息.日主}
                    </div>
                    <div className="space-y-2">
                        <div className="font-display text-lg text-foreground">
                            日主「{canonicalChart.基本信息.日主}」，五行属{dayMasterElement}
                        </div>
                        <p className="max-w-2xl text-sm leading-relaxed text-foreground-secondary">
                            {dayMasterDescription}
                        </p>
                    </div>
                </div>
            </section>

            {/* 2. AI 专业分析区域 */}
            <AIFeatureGate>
            <div className="flex flex-col gap-6">
                {/* 五行分析 */}
                {!hasKnownBirthTime ? (
                    <AINoticeCard
                        icon={<Info className="h-5 w-5 text-warning" />}
                        title="AI 专业五行分析"
                        subtitle="未知时辰仅支持前端查看，不支持保存与 AI 深度分析"
                        notice="请先补全出生时辰并保存命盘，再使用 AI 深度解读"
                    />
                ) : !isSaved ? (
                    <AINoticeCard
                        icon={<Save className="h-5 w-5 text-clay" />}
                        title="AI 专业五行分析"
                        subtitle="深度洞察五行旺衰与调候建议"
                        notice="请先点击页面右上角「保存」命盘，即可解锁 AI 深度解读功能"
                    />
                ) : !userId ? (
                    <AILoginCard
                        icon={<Sparkles className="h-6 w-6 text-accent-strong" />}
                        title="AI 五行分析"
                        description="登录后解锁完整 AI 深度解读，获取更精准的个性化建议"
                        onLoginRequired={onLoginRequired}
                    />
                ) : (
                    <AIWuxingAnalysis
                        chartId={chartId!}
                        userId={userId}
                        credits={credits}
                        savedAnalysis={savedWuxingAnalysis}
                        savedReasoning={savedWuxingReasoning}
                        savedModelId={savedWuxingModelId}
                        onSaveAnalysis={onSaveWuxingAnalysis || (() => { })}
                        onLoginRequired={onLoginRequired}
                    />
                )}

                {/* 性格分析 */}
                {!hasKnownBirthTime ? (
                    <AINoticeCard
                        icon={<Info className="h-5 w-5 text-warning" />}
                        title="AI 性格特征分析"
                        subtitle="未知时辰仅支持前端查看，不支持保存与 AI 深度分析"
                        notice="请先补全出生时辰并保存命盘，再使用 AI 性格分析"
                    />
                ) : !isSaved ? (
                    <AINoticeCard
                        icon={<User className="h-5 w-5 text-clay" />}
                        title="AI 性格特征分析"
                        subtitle="基于十神命局的深度性格画像"
                        notice="保存命盘后即可开启 AI 性格特征分析"
                    />
                ) : !userId ? (
                    <AILoginCard
                        icon={<User className="h-6 w-6 text-accent-strong" />}
                        title="AI 性格分析"
                        description="登录后解锁基于您命盘的深度性格倾向与职场建议"
                        onLoginRequired={onLoginRequired}
                    />
                ) : (
                    <AIPersonalityAnalysis
                        chartId={chartId!}
                        userId={userId}
                        credits={credits}
                        savedAnalysis={savedPersonalityAnalysis}
                        savedReasoning={savedPersonalityReasoning}
                        savedModelId={savedPersonalityModelId}
                        onSaveAnalysis={onSavePersonalityAnalysis || (() => { })}
                        onLoginRequired={onLoginRequired}
                    />
                )}
            </div>
            </AIFeatureGate>

            {/* 3. 十神知识库 - 独立区域 */}
            <TenGodKnowledge highlightedTenGods={highlightedTenGods} />
        </div>
    );
}
