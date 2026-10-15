/**
 * MBTI 人格详情页面
 * 
 * 显示特定 MBTI 类型的详细信息（查看模式，无维度分析）
 */
'use client'; // 需要 useParams 与客户端加载人格详情 JSON

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PersonalityHero } from '@/components/mbti/PersonalityCard';
import { useHeaderTitle } from '@/components/layout/HeaderMenuContext';
import { PERSONALITY_BASICS, type MBTIType } from '@/lib/divination/mbti';

interface PersonalityData {
    sections: Record<string, string>;
}

export default function PersonalityPage() {
    const router = useRouter();
    const params = useParams();
    const type = params.type as MBTIType;

    const [data, setData] = useState<PersonalityData | null>(null);
    const [loading, setLoading] = useState(true);

    const basic = PERSONALITY_BASICS[type];
    useHeaderTitle(basic ? `${type} ${basic.title}` : null);

    useEffect(() => {
        if (!basic) {
            router.push('/mbti');
            return;
        }

        fetch(`/mbti/personalities/${type}.json`)
            .then(res => res.json())
            .then(data => {
                setData(data);
                setLoading(false);
            })
            .catch(() => {
                setData(null);
                setLoading(false);
            });
    }, [type, basic, router]);

    if (!basic) {
        return null;
    }

    if (loading) {
        return (
            <div className="min-h-full bg-background">
                <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-4 py-4 lg:gap-6 lg:px-8 lg:py-8" aria-busy="true">
                    {/* 返回按钮骨架（移动端返回在顶栏） */}
                    <div className="hidden h-5 w-16 animate-pulse rounded bg-background-secondary lg:block" />
                    {/* 头部骨架 */}
                    <div className="flex flex-col items-center gap-3 rounded-2xl border-[0.5px] border-border bg-surface px-5 py-10">
                        <div className="h-16 w-16 animate-pulse rounded-full bg-background-secondary" />
                        <div className="h-10 w-28 animate-pulse rounded bg-background-secondary" />
                        <div className="h-6 w-32 animate-pulse rounded bg-background-secondary" />
                        <div className="h-4 w-64 max-w-full animate-pulse rounded bg-background-secondary" />
                    </div>
                    {/* 内容骨架 */}
                    {[1, 2, 3].map(i => (
                        <div key={i} className="flex flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-5 lg:p-6">
                            <div className="h-5 w-32 animate-pulse rounded bg-background-secondary" />
                            <div className="h-4 w-full animate-pulse rounded bg-background-secondary" />
                            <div className="h-4 w-5/6 animate-pulse rounded bg-background-secondary" />
                            <div className="h-4 w-4/5 animate-pulse rounded bg-background-secondary" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[820px] animate-fade-in flex-col gap-5 px-4 py-4 lg:gap-6 lg:px-8 lg:py-8">
                {/* 返回（移动端返回在顶栏） */}
                <Link
                    href="/mbti"
                    className="hidden w-fit items-center gap-1 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    返回
                </Link>

                {/* 头部 */}
                <PersonalityHero type={type} />

                {/* 内容 */}
                {data && Object.entries(data.sections).map(([title, content]) => (
                    <section key={title} className="flex flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-5 lg:p-6">
                        <h2 className="font-display text-lg font-medium">{title}</h2>
                        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary lg:text-[0.9375rem]">
                            {content}
                        </p>
                    </section>
                ))}

                {/* 开始测试按钮 */}
                <div className="flex justify-center pt-4">
                    <Link
                        href="/mbti/test"
                        className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-7 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                    >
                        开始 MBTI 测试
                    </Link>
                </div>
            </div>
        </div>
    );
}
