import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';

/** 起卦页标题区：桌面端返回 + 标题；所问之事与用神在各尺寸都显示。 */
export function LiuyaoCastingHeader({ title, description, question, yongShenTargets }: {
    title: string;
    description: string;
    question: string;
    yongShenTargets: readonly string[];
}) {
    return (
        <div className="flex flex-col gap-3">
            <Link
                href="/liuyao"
                className="hidden w-fit items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex"
            >
                <ChevronLeft className="h-4 w-4" />
                返回
            </Link>
            <PageHeader title={title} description={description} />
            {question && (
                <p className="text-center text-[0.8125rem] leading-normal text-foreground-secondary lg:text-left lg:text-sm">
                    问：<span className="text-foreground">{question}</span>
                    {yongShenTargets.length > 0 && <> · 用神 {yongShenTargets.join('、')}</>}
                </p>
            )}
        </div>
    );
}
