/**
 * 64卦选择器
 *
 * 显示64卦网格，支持搜索筛选
 */
'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { HEXAGRAMS, formatHexagramPalace } from '@/lib/divination/liuyao';

interface HexagramSelectorProps {
    value?: string;
    onChange: (code: string) => void;
}

export function HexagramSelector({ value, onChange }: HexagramSelectorProps) {
    const [search, setSearch] = useState('');

    const filtered = search
        ? HEXAGRAMS.filter(h =>
            h.name.includes(search) ||
            h.upperTrigram.includes(search) ||
            h.lowerTrigram.includes(search) ||
            h.nature.includes(search)
        )
        : HEXAGRAMS;

    const selectedHexagram = value ? HEXAGRAMS.find(h => h.code === value) : null;

    return (
        <div className="space-y-3">
            {/* 搜索框 */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-secondary" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索卦名、卦象..."
                    className="h-10 w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface pl-9 pr-4 text-sm
                        placeholder:text-foreground-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
            </div>

            {/* 已选显示 */}
            {selectedHexagram && (
                <div className="flex flex-wrap items-baseline gap-2 rounded-xl bg-accent-light px-3.5 py-2.5 text-sm ring-1 ring-inset ring-accent/50">
                    <span className="font-display text-base text-accent-strong">{selectedHexagram.name}</span>
                    <span className="text-foreground-secondary">
                        {selectedHexagram.upperTrigram}/{selectedHexagram.lowerTrigram} · {formatHexagramPalace(selectedHexagram.code)}
                    </span>
                </div>
            )}

            {/* 卦列表网格 */}
            <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5 max-h-[300px] overflow-y-auto pr-1">
                {filtered.map(h => (
                    <button
                        key={h.code}
                        type="button"
                        onClick={() => onChange(h.code)}
                        aria-pressed={value === h.code}
                        className={`rounded-lg px-1 py-2 text-center font-display text-[13px] transition-colors
                            ${value === h.code
                                ? 'bg-accent-soft text-accent-strong ring-2 ring-inset ring-accent'
                                : 'border-[0.5px] border-border bg-surface text-foreground hover:bg-background-secondary'
                            }`}
                    >
                        {h.name}
                    </button>
                ))}
            </div>

            {filtered.length === 0 && (
                <p className="text-center text-sm text-foreground-secondary py-4">
                    未找到匹配的卦象
                </p>
            )}
        </div>
    );
}
