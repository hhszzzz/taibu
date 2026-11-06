/**
 * 卦象与动爻：自上而下画出本卦六爻，点一爻切换动静；未选卦时显示占位爻线。
 */
'use client';

import { Button } from '@/components/ui/Button';

interface ChangingLinesSelectorProps {
    hexagramCode: string;
    value: number[];
    onChange: (positions: number[]) => void;
}

const YAO_LABELS = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
const POSITIONS_DESC = [6, 5, 4, 3, 2, 1] as const;
const ROW = 'grid h-11 w-full grid-cols-[2.25rem_minmax(0,1fr)_1rem_1.5rem] items-center gap-3 rounded-lg px-2.5';

function Line({ yang, tone }: { yang: boolean; tone: string }) {
    const bar = `h-2.5 rounded-[3px] ${tone}`;
    if (yang) return <span className={`block w-full ${bar}`} />;
    return (
        <span className="flex w-full gap-4">
            <span className={`flex-1 ${bar}`} />
            <span className={`flex-1 ${bar}`} />
        </span>
    );
}

export function ChangingLinesSelector({ hexagramCode, value, onChange }: ChangingLinesSelectorProps) {
    if (hexagramCode.length !== 6) {
        return (
            <div className="flex flex-col gap-1" aria-hidden="true">
                {POSITIONS_DESC.map((position) => (
                    <div key={position} className={ROW}>
                        <span className="text-xs text-foreground-tertiary">{YAO_LABELS[position - 1]}</span>
                        <span className="block h-2.5 w-full rounded-[3px] bg-fill-field" />
                    </div>
                ))}
            </div>
        );
    }

    const toggle = (position: number) => {
        onChange(value.includes(position)
            ? value.filter(p => p !== position)
            : [...value, position].sort((a, b) => a - b));
    };

    return (
        <div className="flex flex-col gap-1" role="group" aria-label="动爻，点一爻切换">
            {POSITIONS_DESC.map((position) => {
                const yang = hexagramCode[position - 1] === '1';
                const moving = value.includes(position);
                return (
                    <Button unstyled
                        key={position}
                        type="button"
                        onClick={() => toggle(position)}
                        aria-pressed={moving}
                        aria-label={`${YAO_LABELS[position - 1]}，${yang ? '阳爻' : '阴爻'}，动爻`}
                        className={`${ROW} transition-colors duration-[var(--duration-snap)] ${moving ? 'bg-accent-light' : 'hover:bg-fill-ghost-hover'}`}
                    >
                        <span className={`text-left text-xs ${moving ? 'font-medium text-accent-strong' : 'text-foreground-secondary'}`}>
                            {YAO_LABELS[position - 1]}
                        </span>
                        <Line yang={yang} tone={moving ? 'bg-accent' : 'bg-foreground'} />
                        <span className="text-center text-sm text-accent" aria-hidden="true">{moving ? (yang ? '○' : '×') : ''}</span>
                        <span className={`text-xs ${moving ? 'text-accent-strong' : 'text-foreground-tertiary'}`}>{moving ? '动' : '静'}</span>
                    </Button>
                );
            })}
        </div>
    );
}
