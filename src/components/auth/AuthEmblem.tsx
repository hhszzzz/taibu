/**
 * 登录弹层的徽记：先天八卦环绕太极。
 *
 * 八卦按先天方位（上南下北）从正上方顺时针排列：乾、巽、坎、艮、坤、震、离、兑；
 * 每卦由内向外画初爻到上爻（1 = 阳爻，0 = 阴爻）。环与太极是两张独立的 svg，
 * 各自缓慢反向旋转（auth.css），只动合成层，不触发重绘；减少动态效果时静止。
 */
const TRIGRAMS = [
    [1, 1, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1],
    [0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 0],
] as const;
const LINE_RADII = [60, 71, 82];
const HALF_LENGTH = 15;
const YIN_GAP = 4;

function Line({ yang, radius }: { yang: number; radius: number }) {
    const y = -radius;
    if (yang) return <line x1={-HALF_LENGTH} y1={y} x2={HALF_LENGTH} y2={y} />;
    return (
        <>
            <line x1={-HALF_LENGTH} y1={y} x2={-YIN_GAP} y2={y} />
            <line x1={YIN_GAP} y1={y} x2={HALF_LENGTH} y2={y} />
        </>
    );
}

export function AuthEmblem({ size, className = '' }: { size: number; className?: string }) {
    return (
        <span className={`auth-emblem ${className}`} style={{ width: size, height: size }} aria-hidden="true">
            <svg className="auth-emblem-ring" viewBox="-100 -100 200 200">
                <circle r="94" />
                <circle r="48" />
                <g className="auth-emblem-lines">
                    {TRIGRAMS.map((lines, index) => (
                        <g key={index} transform={`rotate(${index * 45})`}>
                            {lines.map((yang, line) => <Line key={line} yang={yang} radius={LINE_RADII[line]} />)}
                        </g>
                    ))}
                </g>
            </svg>
            <svg className="auth-emblem-taiji" viewBox="-100 -100 200 200">
                <circle r="36" className="auth-emblem-yang" />
                <path className="auth-emblem-yin" d="M0 -36A36 36 0 0 1 0 36A18 18 0 0 1 0 0A18 18 0 0 0 0 -36Z" />
                <circle cy="-18" r="6" className="auth-emblem-yin" />
                <circle cy="18" r="6" className="auth-emblem-yang" />
                <circle r="36" className="auth-emblem-rim" />
            </svg>
        </span>
    );
}
