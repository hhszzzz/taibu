/**
 * 奇门遁甲排盘输入页面
 *
 * 'use client' 标记说明：
 * - 使用 useState 管理表单状态
 * - 使用 useRouter 进行导航
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';
import { QimenFormPreview } from '@/components/qimen/QimenFormPreview';
import {
    SANSHI_INPUT_CLASS,
    SanshiField,
    SanshiFormCard,
    SanshiRuleGroup,
    SanshiSegmented,
    SanshiSubmitButton,
    SanshiTimeFields,
    type SegmentOption,
    type TimeFieldKey,
} from '@/components/divination/SanshiFormControls';
import { supabase } from '@/lib/auth';
import { writeSessionJSON } from '@/lib/cache/session-storage';

type TimeMode = 'now' | 'custom';
type PanType = 'zhuan';
type JuMethod = 'chaibu' | 'maoshan';
type ZhiFuJiGong = 'jiLiuYi' | 'jiWuGong';

const PAN_TYPE_OPTIONS: ReadonlyArray<SegmentOption<PanType | 'fei'>> = [
    { value: 'zhuan', label: '转盘' },
    { value: 'fei', label: '飞盘 · 暂无', disabled: true },
];

const JU_METHOD_OPTIONS: ReadonlyArray<SegmentOption<JuMethod>> = [
    { value: 'chaibu', label: '拆补' },
    { value: 'maoshan', label: '茅山' },
];

const ZHI_FU_JI_GONG_OPTIONS: ReadonlyArray<SegmentOption<ZhiFuJiGong>> = [
    { value: 'jiLiuYi', label: '寄六仪' },
    { value: 'jiWuGong', label: '寄戊宫' },
];

function getNow() {
    const d = new Date();
    return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour: d.getHours(),
        minute: d.getMinutes(),
    };
}

export default function QimenPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const now = getNow();
    const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';

    const [question, setQuestion] = useState('');
    const [timeMode, setTimeMode] = useState<TimeMode>('now');
    const [year, setYear] = useState(now.year);
    const [month, setMonth] = useState(now.month);
    const [day, setDay] = useState(now.day);
    const [hour, setHour] = useState(now.hour);
    const [minute, setMinute] = useState(now.minute);
    const [panType] = useState<PanType>('zhuan');
    const [juMethod, setJuMethod] = useState<JuMethod>('chaibu');
    const [zhiFuJiGong, setZhiFuJiGong] = useState<ZhiFuJiGong>('jiLiuYi');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async () => {
        setIsLoading(true);
        try {
            const useTime = timeMode === 'now' ? getNow() : { year, month, day, hour, minute };

            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) {
                showToast('error', '请先登录');
                setIsLoading(false);
                return;
            }

            const res = await fetch('/api/qimen', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'calculate',
                    ...useTime,
                    timezone: localTimeZone,
                    question,
                    panType,
                    juMethod,
                    zhiFuJiGong,
                }),
            });

            const data = await res.json();
            if (!data.success) {
                showToast('error', data.error || '排盘失败');
                return;
            }

            writeSessionJSON('qimen_result', {
                ...useTime,
                timezone: localTimeZone,
                question,
                panType,
                juMethod,
                zhiFuJiGong,
                output: data.data,
                createdAt: new Date().toISOString(),
            });
            router.push('/qimen/result');
        } catch (err) {
            console.error('奇门排盘失败:', err);
            showToast('error', '排盘失败，请重试');
        } finally {
            setIsLoading(false);
        }
    };

    const timeSetters: Record<TimeFieldKey, (next: number) => void> = {
        year: setYear,
        month: setMonth,
        day: setDay,
        hour: setHour,
        minute: setMinute,
    };

    /** 编辑任一时间字段即视为活时 */
    const handleTimeFieldChange = (key: TimeFieldKey, next: number) => {
        timeSetters[key](next);
        setTimeMode('custom');
    };

    const handleUseNow = () => {
        const current = getNow();
        setYear(current.year);
        setMonth(current.month);
        setDay(current.day);
        setHour(current.hour);
        setMinute(current.minute);
        setTimeMode('now');
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[1064px] flex-col gap-6 px-4 pb-12 pt-4 lg:gap-7 lg:px-8 lg:pb-16 lg:pt-14">
                {/* 页面标题 - 移动端隐藏（顶栏已显示） */}
                <header className="hidden flex-col gap-2 lg:flex">
                    <h1 className="font-display text-[34px] font-normal leading-tight">奇门遁甲</h1>
                    <p className="text-[15px] text-foreground-secondary">三式之首。以起局时刻排出九宫，看天时、地利与人和。</p>
                </header>

                <div className="flex flex-wrap items-start gap-6">
                    <SanshiFormCard className="flex-[999_1_480px]">
                        <SanshiField label="占问事项" htmlFor="qimen-question">
                            <input
                                id="qimen-question"
                                type="text"
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                placeholder="例如：此次合作能否成功？"
                                className={SANSHI_INPUT_CLASS}
                            />
                        </SanshiField>

                        <SanshiTimeFields
                            label="起局时间"
                            value={{ year, month, day, hour, minute }}
                            isNow={timeMode === 'now'}
                            onFieldChange={handleTimeFieldChange}
                            onUseNow={handleUseNow}
                        />

                        <SanshiRuleGroup
                            title="排盘规则"
                            rows={[
                                { label: '盘式', control: <SanshiSegmented label="盘式" options={PAN_TYPE_OPTIONS} value={panType} /> },
                                { label: '定局法', control: <SanshiSegmented label="定局法" options={JU_METHOD_OPTIONS} value={juMethod} onChange={setJuMethod} /> },
                                { label: '直符寄宫', control: <SanshiSegmented label="直符寄宫" options={ZHI_FU_JI_GONG_OPTIONS} value={zhiFuJiGong} onChange={setZhiFuJiGong} /> },
                            ]}
                        />

                        <SanshiSubmitButton onClick={handleSubmit} loading={isLoading} label="起局" loadingLabel="排盘中..." />
                    </SanshiFormCard>

                    <QimenFormPreview
                        className="flex-[1_1_280px]"
                        input={{ year, month, day, hour, minute, timezone: localTimeZone, panType, juMethod, zhiFuJiGong }}
                    />
                </div>
            </div>
            <HistoryDrawer type="qimen" />
        </div>
    );
}
