/** 卦形小图：code 自下而上（初爻在前），画出时上爻在上；阳爻实线，阴爻中断。 */
const SIZES = {
    xs: { width: 'w-6', line: 'h-[3px]', gap: 'gap-[3px]', split: 'gap-1' },
    sm: { width: 'w-8', line: 'h-1', gap: 'gap-1', split: 'gap-1.5' },
} as const;

export function GuaGlyph({ code, size = 'xs', className = '' }: { code: string; size?: keyof typeof SIZES; className?: string }) {
    const { width, line, gap, split } = SIZES[size];
    const segment = `rounded-[1px] bg-current ${line}`;
    return (
        <span className={`flex flex-col ${gap} ${width} ${className}`} aria-hidden="true">
            {[...code].reverse().map((bit, index) => (
                bit === '1'
                    ? <span key={index} className={`block ${segment}`} />
                    : <span key={index} className={`flex ${split}`}><span className={`flex-1 ${segment}`} /><span className={`flex-1 ${segment}`} /></span>
            ))}
        </span>
    );
}
