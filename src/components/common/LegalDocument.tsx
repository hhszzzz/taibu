/**
 * 法律文档版式：隐私政策、服务条款共用
 *
 * Server Component：纯静态内容，正文与目录都由数据渲染，不需要客户端脚本。
 */
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export type LegalListItem = string | { term: string; text: string };

export interface LegalSection {
    /** 锚点 id，供目录跳转 */
    id: string;
    title: string;
    /** 列表前的段落 */
    lead?: string;
    items?: readonly LegalListItem[];
    /** 列表后的段落 */
    paragraphs?: readonly string[];
    /** 联系邮箱，渲染为 mailto 链接 */
    email?: string;
}

export interface LegalDocumentContent {
    title: string;
    /** 例如「2026 年 2 月 13 日」 */
    updatedAt: string;
    intro: string;
    sections: readonly LegalSection[];
}

/** 中文正文按每分钟约 400 字估算阅读时长，至少 1 分钟。 */
export function estimateLegalReadingMinutes(content: LegalDocumentContent): number {
    const text = [
        content.intro,
        ...content.sections.flatMap(section => [
            section.title,
            section.lead ?? '',
            ...(section.items ?? []).map(item => (typeof item === 'string' ? item : `${item.term}${item.text}`)),
            ...(section.paragraphs ?? []),
        ]),
    ].join('');
    return Math.max(1, Math.round(text.length / 400));
}

function LegalList({ items }: { items: readonly LegalListItem[] }) {
    return (
        <ul className="flex flex-col gap-2">
            {items.map(item => {
                const key = typeof item === 'string' ? item : item.term;
                return (
                    <li key={key} className="relative pl-[18px]">
                        <span aria-hidden="true" className="absolute top-[0.8em] left-0.5 h-[5px] w-[5px] rounded-full bg-accent" />
                        {typeof item === 'string' ? item : (
                            <><strong className="font-medium text-foreground">{item.term}</strong>：{item.text}</>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

export function LegalDocument({ content, backHref, backLabel }: {
    content: LegalDocumentContent;
    backHref: string;
    backLabel: string;
}) {
    const minutes = estimateLegalReadingMinutes(content);

    return (
        <div className="min-h-screen bg-background pb-20 lg:pb-12">
            <div className="mx-auto flex max-w-[61.25rem] flex-col px-4 py-6 md:px-6 md:py-10">
                {/* 手机端顶栏已有返回按钮。 */}
                <Link
                    href={backHref}
                    className="hidden h-9 items-center gap-1.5 self-start rounded-[9px] pr-2.5 pl-1.5 text-sm text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground md:inline-flex"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    {backLabel}
                </Link>

                <header className="flex flex-col gap-2.5 border-b-[0.5px] border-border pb-6 md:mt-5 md:pb-7">
                    <h1 className="font-display text-[2rem] leading-tight font-normal text-foreground md:text-[2.5rem]">{content.title}</h1>
                    <p className="text-sm text-foreground-tertiary">
                        最后更新于 {content.updatedAt} · 约 {minutes} 分钟读完
                    </p>
                </header>

                <div className="mt-8 flex items-start gap-12">
                    <article className="max-w-[42.5rem] min-w-0 flex-1 text-base leading-[1.85] text-foreground-secondary">
                        <p className="font-display text-[1.1875rem] leading-[1.75] text-foreground">{content.intro}</p>
                        {content.sections.map(section => (
                            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="flex scroll-mt-20 flex-col gap-3 pt-9">
                                <h2 id={`${section.id}-title`} className="font-display text-[1.4375rem] leading-snug font-medium text-foreground">{section.title}</h2>
                                {section.lead ? <p>{section.lead}</p> : null}
                                {section.items?.length ? <LegalList items={section.items} /> : null}
                                {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                                {section.email ? (
                                    <p>
                                        <a href={`mailto:${section.email}`} className="text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent">
                                            {section.email}
                                        </a>
                                    </p>
                                ) : null}
                            </section>
                        ))}
                    </article>

                    {/* 手机端不显示目录；平板以上固定在正文右侧并吸顶。 */}
                    <nav aria-label="本页目录" className="sticky top-6 ml-auto hidden w-44 shrink-0 flex-col gap-0.5 md:flex lg:w-[13.75rem]">
                        <span className="pb-2 pl-3.5 text-xs text-foreground-tertiary">目录</span>
                        {content.sections.map(section => (
                            <a
                                key={section.id}
                                href={`#${section.id}`}
                                className="block border-l-2 border-transparent px-3 py-1.5 text-sm text-foreground-secondary transition-colors hover:border-border-hover hover:text-foreground"
                            >
                                {section.title}
                            </a>
                        ))}
                    </nav>
                </div>
            </div>
        </div>
    );
}
