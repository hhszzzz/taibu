/**
 * 64 卦选择器：按文王卦序排列，每格画出卦形；可按卦名、上下卦或卦意筛选。
 */
'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GuaGlyph } from '@/components/liuyao/GuaGlyph';
import { HEXAGRAMS } from '@/lib/divination/liuyao';

interface HexagramSelectorProps {
    value?: string;
    onChange: (code: string) => void;
    /** 网格区域的附加类，例如窄屏限高滚动。 */
    gridClassName?: string;
}

const KING_WEN_ORDER = new Map(HEXAGRAMS.map((hexagram, index) => [hexagram.code, index + 1]));

export function HexagramSelector({ value, onChange, gridClassName = '' }: HexagramSelectorProps) {
    const [search, setSearch] = useState('');
    const keyword = search.trim();

    const filtered = keyword
        ? HEXAGRAMS.filter(h =>
            h.name.includes(keyword) ||
            h.upperTrigram.includes(keyword) ||
            h.lowerTrigram.includes(keyword) ||
            h.nature.includes(keyword)
        )
        : HEXAGRAMS;

    return (
        <div className="@container flex flex-col gap-3">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
                <Input
                    type="search"
                    aria-label="搜索卦"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜卦名、上下卦或卦意，如 屯、坎、等待"
                    className="pl-9"
                />
            </div>

            {filtered.length > 0 ? (
                <div className={`grid grid-cols-4 gap-1 @md:grid-cols-6 @[33rem]:grid-cols-8 ${gridClassName}`}>
                    {filtered.map(h => {
                        const selected = value === h.code;
                        return (
                            <Button unstyled
                                key={h.code}
                                type="button"
                                onClick={() => onChange(h.code)}
                                aria-pressed={selected}
                                title={`第 ${KING_WEN_ORDER.get(h.code)} 卦，上${h.upperTrigram}下${h.lowerTrigram}，主${h.nature}`}
                                className={`flex min-w-0 flex-col items-center gap-2 rounded-xl px-0.5 pb-2 pt-3 transition-colors duration-[var(--duration-snap)] ${selected
                                    ? 'bg-accent-light text-accent-strong ring-1 ring-inset ring-accent'
                                    : 'text-foreground hover:bg-fill-ghost-hover'
                                }`}
                            >
                                <GuaGlyph code={h.code} className={selected ? 'text-accent' : 'text-foreground-secondary'} />
                                <span className="max-w-full truncate font-display text-[0.8125rem] leading-tight">{h.name}</span>
                            </Button>
                        );
                    })}
                </div>
            ) : (
                <p className="py-8 text-center text-sm text-foreground-secondary">
                    没有与「{keyword}」相关的卦，换个字试试
                </p>
            )}
        </div>
    );
}
