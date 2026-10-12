/**
 * 可分享的运势卡片组件
 *
 * 将今日运势渲染为精美的可分享卡片
 * 'use client'：需要 useRef/useState 与浏览器截图（html2canvas）。
 *
 * 截图区域使用固定的浅色"象牙 + 陶土"色板（内联样式），保证导出图片在任何主题下一致，
 * 且不依赖 html2canvas 对 CSS 变量 / 现代颜色函数的支持。
 */
'use client';

import { useRef, useState } from 'react';
import {
    Download,
    Share2,
    Star,
    Briefcase,
    Heart,
    Wallet,
    Activity,
    Check,
    Calendar,
    Sparkles,
    Users,
} from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { downloadShareCard, shareCard } from '@/lib/share-card';
import type { DailyFortune, FortuneLevels, FortuneChartScores } from '@/lib/divination/fortune';
import { fortuneLevelToChartValue, isLevelFavorable } from '@/lib/divination/fortune';
import type { FortuneLevel } from '@/types';

interface ShareCardProps {
    /** 运势数据 */
    fortune: DailyFortune | (FortuneLevels & { advice: string[]; date?: string; _chart?: FortuneChartScores });
    /** 日期 */
    date: Date;
    /** 用户名 / 命盘名称（可选） */
    userName?: string;
    /** 是否为个性化运势 */
    isPersonalized?: boolean;
    /** 黄历宜忌（可选） */
    almanac?: {
        yi?: string[];
        ji?: string[];
    };
}

/** 导出图片专用的固定浅色色板（与 globals.css 浅色 token 取值一致）。 */
const CARD_PALETTE = {
    paper: '#FAF9F5',
    hairline: 'rgba(31, 30, 29, 0.12)',
    track: '#F0EEE6',
    text: '#141413',
    textSecondary: '#5E5D59',
    textTertiary: '#73726C',
    clay: '#B4532F',
    favorable: '#44663A',
    neutral: '#85602A',
    unfavorable: '#A63D2C',
} as const;

const DISPLAY_FONT = "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif";

const scoreItemsWithColors = [
    { key: 'overall', label: '综合', icon: Star, iconColor: CARD_PALETTE.clay },
    { key: 'career', label: '事业', icon: Briefcase, iconColor: '#2F5F86' },
    { key: 'love', label: '感情', icon: Heart, iconColor: '#6B4D9E' },
    { key: 'wealth', label: '财运', icon: Wallet, iconColor: CARD_PALETTE.favorable },
    { key: 'health', label: '健康', icon: Activity, iconColor: CARD_PALETTE.unfavorable },
    { key: 'social', label: '人际', icon: Users, iconColor: CARD_PALETTE.neutral },
];

export function ShareCard({ fortune, date, userName, isPersonalized, almanac }: ShareCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [shareSuccess, setShareSuccess] = useState(false);

    const formatDate = (d: Date) => {
        return d.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
        });
    };

    const formatDateShort = (d: Date) => {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const handleDownload = async () => {
        if (!cardRef.current) return;

        setIsGenerating(true);
        try {
            await downloadShareCard(
                { element: cardRef.current },
                `taibu-fortune-${formatDateShort(date)}.png`
            );
        } catch (error) {
            console.error('下载失败:', error);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleShare = async () => {
        if (!cardRef.current) return;

        setIsGenerating(true);
        try {
            const shared = await shareCard(
                { element: cardRef.current },
                {
                    title: `太卜 ${formatDate(date)} 运势`,
                    text: `我的${isPersonalized ? '个性化' : '今日'}运势 - 综合运势：${fortune.overall}`,
                }
            );
            if (shared) {
                setShareSuccess(true);
                setTimeout(() => setShareSuccess(false), 2000);
            }
        } catch (error) {
            console.error('分享失败:', error);
        } finally {
            setIsGenerating(false);
        }
    };

    const getLevelColor = (level: FortuneLevel): string => {
        if (isLevelFavorable(level)) return CARD_PALETTE.favorable;
        if (level === '平') return CARD_PALETTE.neutral;
        return CARD_PALETTE.unfavorable;
    };

    return (
        <div className="space-y-4">
            {/* 操作按钮 */}
            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={handleDownload}
                    disabled={isGenerating}
                    className="flex h-10 items-center gap-2 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-4 transition-colors hover:bg-background-secondary disabled:opacity-50"
                >
                    {isGenerating ? (
                        <SoundWaveLoader variant="inline" />
                    ) : (
                        <Download className="w-4 h-4" />
                    )}
                    <span className="text-sm">保存图片</span>
                </button>
                <button
                    onClick={handleShare}
                    disabled={isGenerating}
                    className="flex h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                    {shareSuccess ? (
                        <Check className="w-4 h-4" />
                    ) : isGenerating ? (
                        <SoundWaveLoader variant="inline" />
                    ) : (
                        <Share2 className="w-4 h-4" />
                    )}
                    <span className="text-sm">{shareSuccess ? '已分享' : '分享'}</span>
                </button>
            </div>

            {/* 可截图的卡片区域 - 使用内联样式确保 html2canvas 兼容 */}
            <div
                ref={cardRef}
                style={{
                    background: CARD_PALETTE.paper,
                    borderRadius: '16px',
                    padding: '24px',
                    boxShadow: '0 6px 24px rgba(20, 20, 19, 0.07)',
                    border: `1px solid ${CARD_PALETTE.hairline}`,
                    color: CARD_PALETTE.text,
                    minWidth: '320px',
                    maxWidth: '400px',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
            >
                {/* 卡片头部 */}
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                        <Calendar style={{ width: '18px', height: '18px', color: CARD_PALETTE.clay }} />
                        <span style={{ color: CARD_PALETTE.text, fontFamily: DISPLAY_FONT, fontSize: '17px' }}>{formatDate(date)}</span>
                    </div>
                    {isPersonalized && userName && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '14px', color: CARD_PALETTE.clay }}>
                            <Sparkles style={{ width: '16px', height: '16px' }} />
                            <span>{userName} 的个性化运势</span>
                        </div>
                    )}
                </div>

                {/* 运势评分 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                    {scoreItemsWithColors.map(item => {
                        const level = fortune[item.key as keyof typeof fortune] as FortuneLevel;
                        const chartValue = fortuneLevelToChartValue(level);
                        const Icon = item.icon;

                        return (
                            <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '64px' }}>
                                    <Icon style={{ width: '16px', height: '16px', color: item.iconColor }} />
                                    <span style={{ fontSize: '14px', color: CARD_PALETTE.text }}>{item.label}</span>
                                </div>
                                <div style={{ flex: 1, height: '8px', backgroundColor: CARD_PALETTE.track, borderRadius: '9999px', overflow: 'hidden' }}>
                                    <div
                                        style={{
                                            height: '100%',
                                            width: `${chartValue}%`,
                                            backgroundColor: getLevelColor(level),
                                            borderRadius: '9999px',
                                        }}
                                    />
                                </div>
                                <span style={{ width: '40px', textAlign: 'right', fontWeight: 600, color: getLevelColor(level), fontSize: '15px' }}>
                                    {level}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* 黄历宜忌 */}
                {almanac && (almanac.yi?.length || almanac.ji?.length) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px 0', borderTop: `1px solid ${CARD_PALETTE.hairline}` }}>
                        <div>
                            <div style={{ color: CARD_PALETTE.favorable, fontSize: '16px', fontFamily: DISPLAY_FONT, marginBottom: '8px' }}>宜</div>
                            <div style={{ fontSize: '12px', color: CARD_PALETTE.textSecondary }}>
                                {almanac.yi?.slice(0, 3).map((item, i) => (
                                    <div key={i} style={{ marginBottom: '4px' }}>{item}</div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div style={{ color: CARD_PALETTE.unfavorable, fontSize: '16px', fontFamily: DISPLAY_FONT, marginBottom: '8px' }}>忌</div>
                            <div style={{ fontSize: '12px', color: CARD_PALETTE.textSecondary }}>
                                {almanac.ji?.slice(0, 3).map((item, i) => (
                                    <div key={i} style={{ marginBottom: '4px' }}>{item}</div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* 今日建议 */}
                {fortune.advice && fortune.advice.length > 0 && (
                    <div style={{ paddingTop: '16px', borderTop: `1px solid ${CARD_PALETTE.hairline}` }}>
                        <div style={{ fontSize: '12px', color: CARD_PALETTE.clay, marginBottom: '8px', fontWeight: 500 }}>今日建议</div>
                        <div style={{ fontSize: '14px', color: CARD_PALETTE.text }}>
                            {fortune.advice[0]}
                        </div>
                    </div>
                )}

                {/* 水印 */}
                <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${CARD_PALETTE.hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/Logo.svg"
                            alt="太卜"
                            style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '8px',
                                objectFit: 'cover',
                            }}
                        />
                        <span style={{ fontSize: '13px', color: CARD_PALETTE.clay, fontWeight: 600 }}>太卜</span>
                    </div>
                    <span style={{ fontSize: '12px', color: CARD_PALETTE.textTertiary }}>AI智能命理平台</span>
                </div>
            </div>
        </div>
    );
}
