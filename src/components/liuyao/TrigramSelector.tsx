/**
 * 八卦选择器
 *
 * 显示8个经卦，用于上卦/下卦选择
 */
'use client';

interface TrigramSelectorProps {
    label: string;
    value?: string;
    onChange: (code: string) => void;
}

const TRIGRAMS_LIST = [
    { name: '乾', code: '111', symbol: '☰', element: '天', wuxing: '金' },
    { name: '兑', code: '110', symbol: '☱', element: '泽', wuxing: '金' },
    { name: '离', code: '101', symbol: '☲', element: '火', wuxing: '火' },
    { name: '震', code: '100', symbol: '☳', element: '雷', wuxing: '木' },
    { name: '巽', code: '011', symbol: '☴', element: '风', wuxing: '木' },
    { name: '坎', code: '010', symbol: '☵', element: '水', wuxing: '水' },
    { name: '艮', code: '001', symbol: '☶', element: '山', wuxing: '土' },
    { name: '坤', code: '000', symbol: '☷', element: '地', wuxing: '土' },
];

export function TrigramSelector({ label, value, onChange }: TrigramSelectorProps) {
    const selectedTrigram = value ? TRIGRAMS_LIST.find(t => t.code === value) : null;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-foreground">{label}</h4>
                {selectedTrigram && (
                    <span className="text-xs font-medium text-accent-strong">
                        {selectedTrigram.symbol} {selectedTrigram.name} ({selectedTrigram.element})
                    </span>
                )}
            </div>
            <div className="grid grid-cols-4 gap-2">
                {TRIGRAMS_LIST.map(t => (
                    <button
                        key={t.code}
                        type="button"
                        onClick={() => onChange(t.code)}
                        aria-pressed={value === t.code}
                        className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 transition-colors
                            ${value === t.code
                                ? 'bg-accent-soft text-accent-strong ring-2 ring-inset ring-accent'
                                : 'border-[0.5px] border-border bg-surface text-foreground hover:bg-background-secondary'
                            }`}
                    >
                        <span className="text-xl">{t.symbol}</span>
                        <span className="font-display text-sm">{t.name}</span>
                        <span className="text-[10px] text-foreground-secondary">{t.element}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

