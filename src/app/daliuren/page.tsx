/**
 * 大六壬排盘主页面
 * 需要 useState + 路由跳转
 */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';
import { FeatureGate } from '@/components/layout/FeatureGate';
import { DaliurenFormPreview } from '@/components/daliuren/DaliurenFormPreview';
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
import { writeSessionJSON } from '@/lib/cache/session-storage';

type TimeMode = 'now' | 'custom';
type Gender = 'male' | 'female' | '';

const GENDER_OPTIONS: ReadonlyArray<SegmentOption<Gender>> = [
    { value: '', label: '不填' },
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
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

const DEFAULT_FORM_TIME = {
    year: 2000,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
};

export default function DaliurenPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [question, setQuestion] = useState('');
    const [timeMode, setTimeMode] = useState<TimeMode>('now');
    const [localTimeZone, setLocalTimeZone] = useState('Asia/Shanghai');
    const [year, setYear] = useState(DEFAULT_FORM_TIME.year);
    const [month, setMonth] = useState(DEFAULT_FORM_TIME.month);
    const [day, setDay] = useState(DEFAULT_FORM_TIME.day);
    const [hour, setHour] = useState(DEFAULT_FORM_TIME.hour);
    const [minute, setMinute] = useState(DEFAULT_FORM_TIME.minute);

    // 高级设置
    const [birthYear, setBirthYear] = useState('');
    const [gender, setGender] = useState<Gender>('');

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const now = getNow();
        setYear(now.year);
        setMonth(now.month);
        setDay(now.day);
        setHour(now.hour);
        setMinute(now.minute);
        setLocalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');
    }, []);

    const birthYearValue = birthYear ? parseInt(birthYear, 10) : undefined;

    const handleStartDivination = async () => {
        const useTime = timeMode === 'now' ? getNow() : { year, month, day, hour, minute };
        if (!useTime.year || !useTime.month || !useTime.day) {
            showToast('error', '请填写完整的日期');
            return;
        }
        setIsLoading(true);
        try {
            const date = `${useTime.year}-${String(useTime.month).padStart(2, '0')}-${String(useTime.day).padStart(2, '0')}`;
            const params = {
                date,
                hour: useTime.hour,
                minute: useTime.minute,
                timezone: localTimeZone,
                question: question.trim() || undefined,
                birthYear: birthYearValue,
                gender: gender || undefined,
            };
            writeSessionJSON('daliuren_params', params);
            router.push('/daliuren/result');
        } catch {
            showToast('error', '起课失败，请重试');
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
        <FeatureGate featureId="daliuren">
            <div className="min-h-screen bg-background text-foreground">
                <div className="mx-auto flex w-full max-w-[1064px] flex-col gap-6 px-4 pb-12 pt-4 lg:gap-7 lg:px-8 lg:pb-16 lg:pt-14">
                    {/* 页面标题 - 移动端隐藏（顶栏已显示） */}
                    <header className="hidden flex-col gap-2 lg:flex">
                        <h1 className="font-display text-[34px] font-normal leading-tight">大六壬</h1>
                        <p className="text-[15px] text-foreground-secondary">三式之一。以起课时刻排出天地盘、四课与三传，推演事态的来龙去脉。</p>
                    </header>

                    <div className="flex flex-wrap items-start gap-6">
                        <SanshiFormCard className="flex-[999_1_480px]">
                            <SanshiField label="占问事项" htmlFor="daliuren-question">
                                <input
                                    id="daliuren-question"
                                    type="text"
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    placeholder="例如：此事能否顺利？"
                                    className={SANSHI_INPUT_CLASS}
                                />
                            </SanshiField>

                            <SanshiTimeFields
                                label="起课时间"
                                value={{ year, month, day, hour, minute }}
                                isNow={timeMode === 'now'}
                                onFieldChange={handleTimeFieldChange}
                                onUseNow={handleUseNow}
                            />

                            <SanshiRuleGroup
                                title="本命"
                                rows={[
                                    {
                                        label: '出生年份',
                                        control: (
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                value={birthYear}
                                                onChange={e => setBirthYear(e.target.value)}
                                                placeholder="如 1990"
                                                aria-label="出生年份"
                                                className="h-10 w-full max-w-[320px] rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3 text-sm text-foreground placeholder:text-foreground-tertiary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/10"
                                            />
                                        ),
                                    },
                                    { label: '性别', control: <SanshiSegmented label="性别" options={GENDER_OPTIONS} value={gender} onChange={setGender} /> },
                                ]}
                            />

                            <SanshiSubmitButton onClick={handleStartDivination} loading={isLoading} label="起课" loadingLabel="起课中..." />
                        </SanshiFormCard>

                        <DaliurenFormPreview
                            className="flex-[1_1_280px]"
                            input={{
                                date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                                hour,
                                minute,
                                timezone: localTimeZone,
                                birthYear: birthYearValue,
                                gender: gender || undefined,
                            }}
                        />
                    </div>
                </div>
                <HistoryDrawer type="daliuren" />
            </div>
        </FeatureGate>
    );
}
