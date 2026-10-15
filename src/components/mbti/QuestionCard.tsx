/**
 * MBTI 测试题目卡片（7 级量表，设计稿 MbtiTest / MobileMbti）
 *
 * 移动端：量表一行铺满，两极文字在下方；桌面端：左文字 · 量表 · 右文字同一行。
 * 左侧（A）为陶土色；右侧（B）移动端为水色、桌面端为墨色。越靠两端圆越大。
 */
'use client'; // 量表点击回调来自客户端测试流程

import { useId } from 'react';
import { type MBTIQuestion, type LikertValue } from '@/lib/divination/mbti';

type LikertSide = 'a' | 'neutral' | 'b';

const LIKERT_OPTIONS: ReadonlyArray<{ value: LikertValue; side: LikertSide; degree: string; sizeClass: string }> = [
    { value: 1, side: 'a', degree: '非常', sizeClass: 'size-[30px] lg:size-10' },
    { value: 2, side: 'a', degree: '比较', sizeClass: 'size-[25px] lg:size-[34px]' },
    { value: 3, side: 'a', degree: '略微', sizeClass: 'size-5 lg:size-7' },
    { value: 4, side: 'neutral', degree: '', sizeClass: 'size-4 lg:size-[22px]' },
    { value: 5, side: 'b', degree: '略微', sizeClass: 'size-5 lg:size-7' },
    { value: 6, side: 'b', degree: '比较', sizeClass: 'size-[25px] lg:size-[34px]' },
    { value: 7, side: 'b', degree: '非常', sizeClass: 'size-[30px] lg:size-10' },
];

const SIDE_CLASS: Record<LikertSide, { idle: string; selected: string }> = {
    a: {
        idle: 'border-accent group-hover:bg-accent-light',
        selected: 'border-accent bg-accent',
    },
    neutral: {
        idle: 'border-foreground-secondary group-hover:bg-background-secondary lg:border-foreground-tertiary/70',
        selected: 'border-foreground-secondary bg-foreground-secondary',
    },
    b: {
        idle: 'border-water group-hover:bg-water-soft lg:border-foreground/80 lg:group-hover:bg-background-secondary',
        selected: 'border-water bg-water lg:border-foreground/80 lg:bg-foreground/80',
    },
};

export function QuestionCard({
    question,
    questionNumber,
    selectedValue,
    isCurrent = false,
    onAnswer,
}: {
    question: MBTIQuestion;
    questionNumber: number;
    selectedValue?: LikertValue;
    /** 本页第一道未答题，描边提示从这里作答 */
    isCurrent?: boolean;
    onAnswer: (likertValue: LikertValue) => void;
}) {
    const titleId = useId();

    return (
        <section
            aria-labelledby={titleId}
            className={`flex flex-col gap-3.5 rounded-2xl border-[0.5px] border-border bg-surface p-4 text-foreground transition-shadow duration-150 lg:gap-5 lg:rounded-[18px] lg:px-7 lg:py-[26px] ${isCurrent ? 'ring-[1.5px] ring-inset ring-accent lg:border lg:border-accent/50 lg:ring-0' : ''}`}
        >
            <h2 id={titleId} className="font-display text-[1.0625rem] font-normal leading-normal lg:text-xl lg:leading-[1.4]">
                {questionNumber}. {question.question}
            </h2>

            <div className="flex flex-col gap-3.5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-4">
                {/* 两极文字只作视觉提示，读屏通过每档的 aria-label 获取；移动端触控区 44px，用负外边距保持设计稿间距 */}
                <span aria-hidden="true" className="hidden text-right text-[0.9375rem] text-accent-strong lg:block">{question.choice_a.text}</span>
                <div role="radiogroup" aria-labelledby={titleId} className="-mx-[5px] -my-[7px] flex items-center justify-between py-1 lg:m-0 lg:justify-center lg:gap-3 lg:p-0">
                    {LIKERT_OPTIONS.map(({ value, side, degree, sizeClass }) => {
                        const isSelected = selectedValue === value;
                        const tone = SIDE_CLASS[side];
                        const label = side === 'neutral'
                            ? '中立'
                            : `${degree}倾向：${side === 'a' ? question.choice_a.text : question.choice_b.text}`;
                        return (
                            <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                aria-label={label}
                                onClick={() => onAnswer(value)}
                                className="group flex h-11 items-center justify-center rounded-full px-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:h-10 lg:px-0"
                            >
                                <span
                                    aria-hidden="true"
                                    className={`block rounded-full border-[1.5px] transition-colors duration-150 ${sizeClass} ${isSelected ? tone.selected : `bg-surface ${tone.idle}`}`}
                                />
                            </button>
                        );
                    })}
                </div>
                <span aria-hidden="true" className="hidden text-[0.9375rem] text-foreground/80 lg:block">{question.choice_b.text}</span>
                <div aria-hidden="true" className="flex justify-between gap-4 text-[0.8125rem] leading-snug lg:hidden">
                    <span className="max-w-[45%] text-accent-strong">{question.choice_a.text}</span>
                    <span className="max-w-[45%] text-right text-water">{question.choice_b.text}</span>
                </div>
            </div>
        </section>
    );
}
