/**
 * 大六壬排盘主页面
 * 需要 useState + 路由跳转
 */
'use client';

import { useState } from 'react';
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
    useSanshiFormTime,
    type SegmentOption,
} from '@/components/divination/SanshiFormControls';
import { writeSessionJSON } from '@/lib/cache/session-storage';

type Gender = 'male' | 'female' | '';

const GENDER_OPTIONS: ReadonlyArray<SegmentOption<Gender>> = [
    { value: '', label: '不填' },
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
];

export default function DaliurenPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const formTime = useSanshiFormTime();
    const [question, setQuestion] = useState('');

    // 高级设置
    const [birthYear, setBirthYear] = useState('');
    const [gender, setGender] = useState<Gender>('');

    const [isLoading, setIsLoading] = useState(false);

    const birthYearValue = birthYear ? parseInt(birthYear, 10) : undefined;
    const { year, month, day, hour, minute } = formTime.value;

    const handleStartDivination = async () => {
        const castTime = formTime.resolveTime();
        if (!castTime.year || !castTime.month || !castTime.day) {
            showToast('error', '请填写完整的日期');
            return;
        }
        setIsLoading(true);
        try {
            const date = `${castTime.year}-${String(castTime.month).padStart(2, '0')}-${String(castTime.day).padStart(2, '0')}`;
            const params = {
                date,
                hour: castTime.hour,
                minute: castTime.minute,
                timezone: formTime.timeZone,
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
                                value={formTime.value}
                                isNow={formTime.isNow}
                                onFieldChange={formTime.setField}
                                onUseNow={formTime.resetToNow}
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
                                timezone: formTime.timeZone,
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
