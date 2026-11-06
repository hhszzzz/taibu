/**
 * 八卦选择器：先天八卦序，每格画出三爻卦形，用于上卦/下卦选择。
 */
'use client';

import { Button } from '@/components/ui/Button';
import { GuaGlyph } from '@/components/liuyao/GuaGlyph';

interface TrigramSelectorProps {
    label: string;
    value?: string;
    onChange: (code: string) => void;
}

/** code 自下而上，与六十四卦的卦码一致。 */
export const TRIGRAMS_LIST = [
    { name: '乾', code: '111', nature: '天' },
    { name: '兑', code: '110', nature: '泽' },
    { name: '离', code: '101', nature: '火' },
    { name: '震', code: '100', nature: '雷' },
    { name: '巽', code: '011', nature: '风' },
    { name: '坎', code: '010', nature: '水' },
    { name: '艮', code: '001', nature: '山' },
    { name: '坤', code: '000', nature: '地' },
] as const;

export function TrigramSelector({ label, value, onChange }: TrigramSelectorProps) {
    const selected = TRIGRAMS_LIST.find(t => t.code === value);

    return (
        <div className="@container flex flex-col gap-2.5" role="group" aria-label={label}>
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">{label}</h3>
                <span className="text-xs text-foreground-secondary">{selected ? `${selected.name}为${selected.nature}` : '未选'}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 @md:grid-cols-8">
                {TRIGRAMS_LIST.map(t => {
                    const isSelected = value === t.code;
                    return (
                        <Button unstyled
                            key={t.code}
                            type="button"
                            onClick={() => onChange(t.code)}
                            aria-pressed={isSelected}
                            aria-label={`${t.name}，${t.nature}`}
                            className={`flex flex-col items-center gap-2 rounded-xl pb-2 pt-3 transition-colors duration-[var(--duration-snap)] ${isSelected
                                ? 'bg-accent-light text-accent-strong ring-1 ring-inset ring-accent'
                                : 'border-[0.5px] border-border text-foreground hover:bg-fill-ghost-hover'
                            }`}
                        >
                            <GuaGlyph code={t.code} size="sm" className={isSelected ? 'text-accent' : 'text-foreground-secondary'} />
                            <span className="flex items-baseline gap-1">
                                <span className="font-display text-[0.9375rem] leading-none">{t.name}</span>
                                <span className={`text-[0.6875rem] leading-none ${isSelected ? '' : 'text-foreground-tertiary'}`}>{t.nature}</span>
                            </span>
                        </Button>
                    );
                })}
            </div>
        </div>
    );
}
