import { useId, type CSSProperties } from 'react';
import './liuyao-casting.css';

/** 乾隆通宝的钱文，直读：上、下、右、左。 */
const LEGEND = [
    { char: '乾', x: 50, y: 21.5 },
    { char: '隆', x: 50, y: 79 },
    { char: '通', x: 79, y: 50.5 },
    { char: '宝', x: 21, y: 50.5 },
] as const;

/** 一面钱：外郭、方孔与孔郭；字面铸钱文，背面光背。方孔用遮罩挖空，透出底色。 */
function CoinFace({ side }: { side: 'front' | 'back' }) {
    const id = useId();
    const isFront = side === 'front';
    return (
        <svg viewBox="0 0 100 100" className={`liuyao-coin__face liuyao-coin__face--${side}`} aria-hidden="true">
            <defs>
                <radialGradient id={`${id}-metal`} cx="34%" cy="28%" r="78%">
                    <stop offset="0" style={{ stopColor: isFront ? 'var(--coin-hi)' : 'var(--coin-back-hi)' }} />
                    <stop offset=".6" style={{ stopColor: isFront ? 'var(--coin-body)' : 'var(--coin-back-body)' }} />
                    <stop offset="1" style={{ stopColor: 'var(--coin-rim)' }} />
                </radialGradient>
                <mask id={`${id}-hole`}>
                    <circle cx="50" cy="50" r="48" fill="white" />
                    <rect x="40" y="40" width="20" height="20" fill="black" />
                </mask>
            </defs>
            <g mask={`url(#${id}-hole)`}>
                <circle cx="50" cy="50" r="48" fill={`url(#${id}-metal)`} />
                <circle cx="50" cy="50" r="42.5" fill="none" strokeWidth="1.4" style={{ stroke: 'var(--coin-rim)' }} opacity=".7" />
                <circle cx="50" cy="50" r="47.3" fill="none" strokeWidth="1.2" style={{ stroke: 'var(--coin-rim)' }} opacity=".55" />
                <rect x="34.5" y="34.5" width="31" height="31" fill="none" strokeWidth="1.4" style={{ stroke: 'var(--coin-rim)' }} opacity=".7" />
                {isFront && LEGEND.map(({ char, x, y }) => (
                    <text
                        key={char}
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="20"
                        style={{ fill: 'var(--coin-ink)', fontFamily: 'var(--font-brand)' }}
                    >
                        {char}
                    </text>
                ))}
            </g>
        </svg>
    );
}

export interface CopperCoinProps {
    /** true 为背面朝上（计入「背」），false 为字面朝上。 */
    back: boolean;
    /** 抛掷前朝上的一面，翻转从这一面开始。 */
    fromBack?: boolean;
    tossing?: boolean;
    /** 平面内的摆放角度，让三枚钱不至于排得太齐。 */
    tilt?: number;
    delayMs?: number;
    spins?: number;
    className?: string;
}

/** 方孔铜钱：字面与背面贴在一枚钱的两侧，抛掷时腾起翻转，落在 back 指定的一面。 */
export function CopperCoin({ back, fromBack = false, tossing = false, tilt = 0, delayMs = 0, spins = 3, className = '' }: CopperCoinProps) {
    const style = {
        '--coin-tilt': `${tilt}deg`,
        '--coin-turn': back ? '180deg' : '0deg',
        '--coin-from': fromBack ? '180deg' : '0deg',
        '--coin-delay': `${delayMs}ms`,
        '--coin-spins': spins,
    } as CSSProperties;
    return (
        <span className={`liuyao-coin ${className}`} data-tossing={tossing || undefined} style={style}>
            <span className="liuyao-coin__shadow" aria-hidden="true" />
            <span className="liuyao-coin__hop">
                <span className="liuyao-coin__body">
                    <CoinFace side="front" />
                    <CoinFace side="back" />
                </span>
            </span>
        </span>
    );
}
