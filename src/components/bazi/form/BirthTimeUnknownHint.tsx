'use client';

// 时辰未知时的出口：带着已填的出生信息打开 Agent，让它按已发生的事反推时辰。
import Link from 'next/link';
import type { BaziFormData } from '@/types';
import { DEFAULT_BAZI_FORM_DATA } from '@/components/bazi/form/options';

type DraftSource = Pick<BaziFormData, 'calendarType' | 'birthYear' | 'birthMonth' | 'birthDay' | 'birthPlace'>;

function buildDraft(formData?: DraftSource) {
    // 表单默认就是今天，和默认值相同说明用户还没改过，不值得写进草稿。
    const typedDate = formData && [formData.birthYear, formData.birthMonth, formData.birthDay].join('-') !==
        [DEFAULT_BAZI_FORM_DATA.birthYear, DEFAULT_BAZI_FORM_DATA.birthMonth, DEFAULT_BAZI_FORM_DATA.birthDay].join('-');
    const calendar = formData?.calendarType === 'lunar' ? '农历' : '公历';
    const facts = [
        typedDate ? `出生日期：${formData!.birthYear} 年 ${formData!.birthMonth} 月 ${formData!.birthDay} 日（${calendar}）` : null,
        formData?.birthPlace ? `出生地：${formData.birthPlace}` : null,
    ].filter(Boolean);
    const question = '我不知道自己的出生时辰，想按人生中已经发生的事反推。';
    return facts.length ? `${question}${facts.join('；')}。` : question;
}

export function BirthTimeUnknownHint({ formData, className = '' }: { formData?: DraftSource; className?: string }) {
    const draft = buildDraft(formData);
    return (
        <span className={`text-[13px] leading-relaxed text-foreground-tertiary ${className}`}>
            不知道出生时辰？
            <Link href={`/chat?mode=agent&draft=${encodeURIComponent(draft)}`} className="text-accent underline-offset-2 hover:underline">
                让太卜帮帮你
            </Link>
        </span>
    );
}
