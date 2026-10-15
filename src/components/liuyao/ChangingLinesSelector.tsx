/**
 * 变爻选择器
 *
 * 选择哪些爻位是变爻
 */
'use client';

interface ChangingLinesSelectorProps {
    hexagramCode: string;
    value: number[];
    onChange: (positions: number[]) => void;
}

const YAO_LABELS = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];

export function ChangingLinesSelector({ hexagramCode, value, onChange }: ChangingLinesSelectorProps) {
    if (!hexagramCode || hexagramCode.length !== 6) {
        return (
            <p className="text-sm text-foreground-secondary text-center py-4">
                请先选择本卦
            </p>
        );
    }

    const toggle = (pos: number) => {
        if (value.includes(pos)) {
            onChange(value.filter(p => p !== pos));
        } else {
            onChange([...value, pos].sort((a, b) => a - b));
        }
    };

    // 从上爻到初爻显示（视觉上从上到下）
    const yaosReversed = hexagramCode.split('').map((char, i) => ({
        position: i + 1,
        isYang: char === '1',
    })).reverse();

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-foreground">选择变爻</h4>
                <span className="text-xs text-foreground-secondary">
                    {value.length > 0 ? `已选 ${value.length} 个变爻` : '可选 0-6 个'}
                </span>
            </div>
            <div className="flex flex-col gap-1 rounded-xl border-[0.5px] border-border bg-background p-2">
                {yaosReversed.map(({ position, isYang }) => {
                    const isChanging = value.includes(position);
                    return (
                        <button
                            key={position}
                            type="button"
                            onClick={() => toggle(position)}
                            aria-pressed={isChanging}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors
                                ${isChanging
                                    ? 'bg-accent-light ring-1 ring-inset ring-accent/50'
                                    : 'hover:bg-background-secondary'
                                }`}
                        >
                            {/* 勾选框 */}
                            <div className={`flex h-4 w-4 items-center justify-center rounded border-2 transition-colors
                                ${isChanging
                                    ? 'border-accent bg-accent'
                                    : 'border-foreground-secondary'
                                }`}
                            >
                                {isChanging && (
                                    <svg className="h-3 w-3 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                )}
                            </div>

                            {/* 爻位名称 */}
                            <span className={`text-xs w-10 ${isChanging ? 'font-medium text-accent-strong' : 'text-foreground-secondary'}`}>
                                {YAO_LABELS[position - 1]}
                            </span>

                            {/* 爻线 */}
                            <div className="flex items-center flex-1">
                                {isYang ? (
                                    <div className={`h-2 w-[62px] rounded-[3px] ${isChanging ? 'bg-accent' : 'bg-foreground'}`} />
                                ) : (
                                    <>
                                        <div className={`h-2 w-[27px] rounded-[3px] ${isChanging ? 'bg-accent' : 'bg-foreground'}`} />
                                        <div className="w-2" />
                                        <div className={`h-2 w-[27px] rounded-[3px] ${isChanging ? 'bg-accent' : 'bg-foreground'}`} />
                                    </>
                                )}
                            </div>

                            {/* 变爻标记 */}
                            {isChanging && (
                                <span className="text-xs font-medium text-accent">变</span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
