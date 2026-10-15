import { HEPAN_PRINCIPLES } from '@/components/hepan/hepan-display';

/** 编号要点列表（移动端单列，桌面端三列） */
function PrincipleList({ className }: { className: string }) {
    return (
        <ol className={className}>
            {HEPAN_PRINCIPLES.map((item, index) => (
                <li key={item.title} className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs text-accent-strong">
                        {index + 1}
                    </span>
                    <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">{item.title}</span>
                        <span className="text-[13px] leading-relaxed text-foreground-secondary">{item.body}</span>
                    </span>
                </li>
            ))}
        </ol>
    );
}

/**
 * 合盘原理解析：移动端为常显卡片，桌面端为默认收起的 details。
 */
export function HepanPrinciples() {
    return (
        <>
            <section aria-labelledby="hepan-principles-mobile" className="flex flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:hidden">
                <h2 id="hepan-principles-mobile" className="font-display text-[17px] font-medium text-foreground">合盘原理解析</h2>
                <PrincipleList className="flex flex-col gap-3" />
            </section>

            <details className="group hidden border-t-[0.5px] border-border pt-[18px] sm:block">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-2 text-[15px] text-foreground [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="text-[10px] text-foreground-secondary transition-transform duration-150 group-open:rotate-90">▶</span>
                    合盘原理解析
                </summary>
                <PrincipleList className="grid grid-cols-3 gap-6 pt-4" />
            </details>
        </>
    );
}
