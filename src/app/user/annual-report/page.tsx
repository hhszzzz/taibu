/**
 * 年度报告页面
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Calendar,
    BarChart3,
    Trophy,
    Flame,
    RefreshCw,
    Star,
    TrendingUp
} from 'lucide-react';
import {
    ANNUAL_REPORT_FEATURE_NAMES,
    type AnnualReportData,
} from '@/lib/annual-report-shared';
import { LoginOverlay } from '@/components/auth/LoginOverlay';
import { useToast } from '@/components/ui/Toast';
import { useSessionSafe } from '@/lib/hooks/session-context';

export default function AnnualReportPage() {
    const { user, loading } = useSessionSafe();
    return <AnnualReportContent key={`${loading}:${user?.id ?? ''}`} enabled={!loading && !!user} />;
}

function AnnualReportContent({ enabled }: { enabled: boolean }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [report, setReport] = useState<AnnualReportData | null>(null);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [error, setError] = useState<string | null>(null);
    const pending = useRef<AbortController | null>(null);

    const fetchReport = useCallback(async (refresh = false) => {
        if (!enabled) { setLoading(false); return; }
        pending.current?.abort();
        const controller = new AbortController();
        pending.current = controller;
        try {
            if (refresh) setRefreshing(true);
            else setLoading(true);
            setError(null);

            const url = `/api/annual-report?year=${selectedYear}&action=report${refresh ? '&refresh=true' : ''}`;
            const res = await fetch(url, { signal: controller.signal });
            const data = await res.json();
            if (controller.signal.aborted) return;

            if (data.success && data.data.report) {
                setReport(data.data.report);
            } else {
                setError(data.error || '获取报告失败');
            }
        } catch (err) {
            if (controller.signal.aborted) return;
            console.error('获取年度报告失败:', err);
            setError('网络错误，请稍后重试');
        } finally {
            if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); }
        }
    }, [selectedYear, enabled]);

    useEffect(() => {
        fetchReport();
        return () => pending.current?.abort();
    }, [fetchReport]);

    const handleRefresh = () => {
        fetchReport(true);
        showToast('info', '正在重新生成报告...');
    };

    // 获取使用最多的功能
    const getTopFeature = () => {
        if (!report) return null;
        const entries = Object.entries(report.featureUsage);
        if (entries.length === 0) return null;
        const sorted = entries.sort((a, b) => b[1] - a[1]);
        return sorted[0];
    };

    // 渲染月度使用柱状图
    const renderMonthlyChart = () => {
        if (!report) return null;
        const maxCount = Math.max(...report.activity.monthlyUsage.map(m => m.count), 1);

        return (
            <div className="flex items-end justify-between h-32 gap-1">
                {Array.from({ length: 12 }, (_, i) => {
                    const data = report.activity.monthlyUsage.find(m => m.month === i + 1);
                    const count = data?.count || 0;
                    const height = (count / maxCount) * 100;

                    return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div
                                className="w-full bg-gradient-to-t from-amber-500 to-orange-400 rounded-t transition-all"
                                style={{ height: `${Math.max(height, 4)}%` }}
                            />
                            <span className="text-[10px] text-foreground-secondary">
                                {i + 1}月
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    };

    // 渲染功能使用分布
    const renderFeatureDistribution = () => {
        if (!report) return null;
        const entries = Object.entries(report.featureUsage)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1]);

        if (entries.length === 0) {
            return <p className="text-foreground-secondary text-center py-4">暂无使用数据</p>;
        }

        const total = entries.reduce((sum, [, count]) => sum + count, 0);

        return (
            <div className="space-y-3">
                {entries.map(([key, count]) => (
                    <div key={key}>
                        <div className="flex justify-between text-sm mb-1">
                            <span>{ANNUAL_REPORT_FEATURE_NAMES[key as keyof typeof ANNUAL_REPORT_FEATURE_NAMES] || key}</span>
                            <span className="text-foreground-secondary">{count}次 ({Math.round(count / total * 100)}%)</span>
                        </div>
                        <div className="h-2 bg-background rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-amber-500 to-orange-500"
                                style={{ width: `${(count / total) * 100}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    if (loading) {
        return (
            <LoginOverlay message="登录后查看年度报告">
                <div className="min-h-screen bg-background">
                    <div className="max-w-3xl mx-auto px-4 py-4 md:py-8">
                        {/* 头部骨架 */}
                        <div className="hidden md:flex items-center justify-between mb-8">
                            <div className="space-y-2">
                                <div className="h-7 w-28 rounded bg-foreground/10 animate-pulse" />
                                <div className="h-4 w-40 rounded bg-foreground/5 animate-pulse" />
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-10 w-24 rounded-lg bg-foreground/5 animate-pulse" />
                                <div className="h-10 w-10 rounded-lg bg-foreground/5 animate-pulse" />
                            </div>
                        </div>
                        {/* 移动端操作栏骨架 */}
                        <div className="md:hidden flex items-center justify-between mb-4">
                            <div className="h-10 w-24 rounded-lg bg-foreground/5 animate-pulse" />
                            <div className="h-10 w-10 rounded-lg bg-foreground/5 animate-pulse" />
                        </div>
                        {/* 总览卡片骨架 */}
                        <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-6 mb-6">
                            <div className="h-6 w-32 rounded bg-foreground/10 animate-pulse mb-4" />
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="text-center p-4 bg-background/50 rounded-xl">
                                        <div className="h-8 w-16 mx-auto rounded bg-foreground/10 animate-pulse mb-2" />
                                        <div className="h-4 w-20 mx-auto rounded bg-foreground/5 animate-pulse" />
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* 其他卡片骨架 */}
                        <div className="space-y-6">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="bg-background-secondary rounded-2xl border border-border p-6">
                                    <div className="h-5 w-32 rounded bg-foreground/10 animate-pulse mb-4" />
                                    <div className="h-32 rounded-xl bg-foreground/5 animate-pulse" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </LoginOverlay>
        );
    }

    const topFeature = getTopFeature();

    return (
        <LoginOverlay message="登录后查看年度报告">
            <div className="min-h-screen bg-background">
                <div className="max-w-3xl mx-auto px-4 py-4 md:py-8">
                    {/* 桌面端头部 */}
                    <div className="hidden md:flex items-center justify-between mb-8">
                        <div>
                            <h1 className="text-2xl font-bold">年度报告</h1>
                            <p className="text-foreground-secondary text-sm mt-1">
                                回顾您的命理探索之旅
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <select
                                value={selectedYear}
                                onChange={e => setSelectedYear(parseInt(e.target.value))}
                                className="px-3 py-2 bg-background-secondary border border-border rounded-lg text-sm"
                            >
                                {[2026, 2025, 2024].map(year => (
                                    <option key={year} value={year}>{year}年</option>
                                ))}
                            </select>
                            <button
                                aria-label="刷新年度报告"
                                onClick={handleRefresh}
                                disabled={refreshing}
                                className="p-2 hover:bg-background-secondary rounded-lg transition-colors"
                            >
                                <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {/* 移动端操作栏 */}
                    <div className="md:hidden flex items-center justify-between mb-4">
                        <select
                            value={selectedYear}
                            onChange={e => setSelectedYear(parseInt(e.target.value))}
                            className="px-3 py-2 bg-background-secondary border border-border rounded-lg text-sm"
                        >
                            {[2026, 2025, 2024].map(year => (
                                <option key={year} value={year}>{year}年</option>
                            ))}
                        </select>
                        <button
                            aria-label="刷新年度报告"
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="p-2 hover:bg-background-secondary rounded-lg transition-colors"
                        >
                            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    {error ? (
                        <div className="text-center py-16">
                            <p className="text-foreground-secondary mb-4">{error}</p>
                            <button
                                onClick={() => fetchReport()}
                                className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                            >
                                重试
                            </button>
                        </div>
                    ) : report ? (
                        <div className="space-y-6">
                            {/* 总览卡片 */}
                            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-6">
                                <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                                    <Calendar className="w-5 h-5 text-amber-500" />
                                    {selectedYear}年度总览
                                </h2>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="text-center p-4 bg-background/50 rounded-xl">
                                        <div className="text-3xl font-bold text-amber-500">{report.usage.totalAnalyses}</div>
                                        <div className="text-sm text-foreground-secondary">总分析次数</div>
                                    </div>
                                    <div className="text-center p-4 bg-background/50 rounded-xl">
                                        <div className="text-3xl font-bold text-orange-500">{report.usage.activeMonths}</div>
                                        <div className="text-sm text-foreground-secondary">活跃月份</div>
                                    </div>
                                    <div className="text-center p-4 bg-background/50 rounded-xl">
                                        <div className="text-3xl font-bold text-red-500">{report.checkin.totalDays}</div>
                                        <div className="text-sm text-foreground-secondary">签到天数</div>
                                    </div>
                                    <div className="text-center p-4 bg-background/50 rounded-xl">
                                        <div className="text-3xl font-bold text-purple-500">{report.usage.totalChats}</div>
                                        <div className="text-sm text-foreground-secondary">AI 对话</div>
                                    </div>
                                </div>
                            </div>

                            {/* 最爱功能 */}
                            {topFeature && topFeature[1] > 0 && (
                                <div className="bg-background-secondary rounded-2xl border border-border p-6">
                                    <h3 className="font-bold mb-4 flex items-center gap-2">
                                        <Star className="w-5 h-5 text-amber-500" />
                                        您最常用的功能
                                    </h3>
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                                            <Trophy className="w-8 h-8 text-amber-500" />
                                        </div>
                                        <div>
                                            <div className="text-xl font-bold">
                                                {ANNUAL_REPORT_FEATURE_NAMES[topFeature[0] as keyof typeof ANNUAL_REPORT_FEATURE_NAMES] || topFeature[0]}
                                            </div>
                                            <div className="text-foreground-secondary">使用了 {topFeature[1]} 次</div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 月度趋势 */}
                            <div className="bg-background-secondary rounded-2xl border border-border p-6">
                                <h3 className="font-bold mb-4 flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-amber-500" />
                                    月度使用趋势
                                </h3>
                                {renderMonthlyChart()}
                            </div>

                            {/* 功能分布 */}
                            <div className="bg-background-secondary rounded-2xl border border-border p-6">
                                <h3 className="font-bold mb-4 flex items-center gap-2">
                                    <BarChart3 className="w-5 h-5 text-amber-500" />
                                    功能使用分布
                                </h3>
                                {renderFeatureDistribution()}
                            </div>

                            {/* 签到成就 */}
                            <div className="bg-background-secondary rounded-2xl border border-border p-6">
                                <h3 className="font-bold mb-4 flex items-center gap-2">
                                    <Flame className="w-5 h-5 text-orange-500" />
                                    签到与积分
                                </h3>
                                <div className="grid grid-cols-2 gap-4 text-center">
                                    <div>
                                        <div className="text-2xl font-bold text-orange-500">{report.checkin.totalDays}</div>
                                        <div className="text-sm text-foreground-secondary">累计签到</div>
                                    </div>
                                    <div>
                                        <div className="text-2xl font-bold text-amber-500">{report.checkin.totalCreditsEarned}</div>
                                        <div className="text-sm text-foreground-secondary">获得积分</div>
                                    </div>
                                </div>
                            </div>

                            {/* 生成时间 */}
                            <div className="text-center text-sm text-foreground-tertiary">
                                报告生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </LoginOverlay>
    );
}
