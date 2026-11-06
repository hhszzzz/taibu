/**
 * 铜钱起卦：三枚铜钱掷六次，自下而上成卦。
 * 左侧托盘里掷钱，右侧逐爻记下单、拆、重、交；手机上可开启摇一摇代替点按。
 */
'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { CopperCoin } from '@/components/liuyao/CopperCoin';
import {
    calculateChangedHexagram,
    findHexagram,
    tossThreeCoins,
    yaosTpCode,
    type CoinTossResult,
    type Yao,
} from '@/lib/divination/liuyao';

interface CoinTossProps {
    onComplete: (yaos: Yao[], results: CoinTossResult[]) => void;
    disabled?: boolean;
}

const SHAKE_THRESHOLD = 15;
const SHAKE_INTERVAL_MS = 1500;
/** 最后一枚钱落定后才记爻；减少动态效果时直接落定。 */
const SETTLE_MS = 1000;
const REDUCED_SETTLE_MS = 150;
const YAO_NAMES = ['初', '二', '三', '四', '五', '上'] as const;
const POSITIONS_DESC = [6, 5, 4, 3, 2, 1] as const;
/** 三枚钱的摆放角度、高低与翻转圈数各不相同，落下时错开一点。 */
const COIN_LAYOUT = [
    { tilt: -14, delayMs: 0, spins: 3, offset: 'translate-y-1.5' },
    { tilt: 9, delayMs: 70, spins: 4, offset: '-translate-y-2' },
    { tilt: 24, delayMs: 140, spins: 3, offset: 'translate-y-2.5' },
] as const;
/** 《卜筮全书》：一背为单，二背为拆，三背为重，三字为交。heads 即背数。 */
const CASTS: Record<number, { faces: string; name: string; yao: string }> = {
    0: { faces: '三字', name: '交', yao: '老阴' },
    1: { faces: '一背二字', name: '单', yao: '少阳' },
    2: { faces: '二背一字', name: '拆', yao: '少阴' },
    3: { faces: '三背', name: '重', yao: '老阳' },
};

const subscribeNothing = () => () => {};
const hasDeviceMotion = () => 'DeviceMotionEvent' in window;

function toYaos(results: CoinTossResult[]): Yao[] {
    return results.map((result, index) => ({
        type: result.yaoType,
        change: result.isChanging ? 'changing' : 'stable',
        position: index + 1,
    }));
}

function hexagramTitle(results: CoinTossResult[]): { base?: string; changed?: string } {
    const yaos = toYaos(results);
    const { changedCode, changedLines } = calculateChangedHexagram(yaos);
    return {
        base: findHexagram(yaosTpCode(yaos))?.name,
        changed: changedLines.length > 0 ? findHexagram(changedCode)?.name : undefined,
    };
}

/** 一根爻线；未掷的位置是浅色占位。 */
function CastLine({ result }: { result?: CoinTossResult }) {
    const bar = 'h-2.5 rounded-[3px]';
    if (!result) return <span className={`block w-full ${bar} bg-fill-field`} />;
    const tone = result.isChanging ? 'bg-accent' : 'bg-foreground';
    if (result.yaoType === 1) return <span className={`liuyao-line-in block w-full ${bar} ${tone}`} />;
    return (
        <span className="liuyao-line-in flex w-full gap-4">
            <span className={`flex-1 ${bar} ${tone}`} />
            <span className={`flex-1 ${bar} ${tone}`} />
        </span>
    );
}

export function CoinToss({ onComplete, disabled = false }: CoinTossProps) {
    const [results, setResults] = useState<CoinTossResult[]>([]);
    const [pending, setPending] = useState<CoinTossResult | null>(null);
    const [tossCount, setTossCount] = useState(0);
    const [shakeEnabled, setShakeEnabled] = useState(false);
    const shakeSupported = useSyncExternalStore(subscribeNothing, hasDeviceMotion, () => false);
    const settleTimer = useRef<number | undefined>(undefined);
    const motionHandler = useRef<((event: DeviceMotionEvent) => void) | null>(null);

    const isComplete = results.length >= 6;
    const lastResult = results.at(-1);
    const shown = pending ?? lastResult;
    const cast = shown ? CASTS[shown.heads] : undefined;
    const title = isComplete ? hexagramTitle(results) : null;

    const toss = () => {
        if (disabled || pending || results.length >= 6) return;
        const result = tossThreeCoins();
        const next = [...results, result];
        setPending(result);
        setTossCount((count) => count + 1);
        if ('vibrate' in navigator) navigator.vibrate(50);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        settleTimer.current = window.setTimeout(() => {
            setResults(next);
            setPending(null);
            if (next.length === 6) onComplete(toYaos(next), next);
        }, reduceMotion ? REDUCED_SETTLE_MS : SETTLE_MS);
    };

    // 摇一摇的监听只注册一次，通过 ref 调用最新的 toss。
    const tossRef = useRef(toss);
    useEffect(() => {
        tossRef.current = toss;
    });

    useEffect(() => () => {
        window.clearTimeout(settleTimer.current);
        if (motionHandler.current) window.removeEventListener('devicemotion', motionHandler.current);
    }, []);

    const enableShake = async () => {
        const Motion = DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> };
        try {
            // iOS 13+ 必须由点按触发授权。
            if (typeof Motion.requestPermission === 'function' && await Motion.requestPermission() !== 'granted') return;
        } catch (error) {
            console.error('Failed to enable shake detection:', error);
            return;
        }
        let last: { x: number; y: number; z: number } | null = null;
        let lastShake = 0;
        const handler = (event: DeviceMotionEvent) => {
            const acceleration = event.accelerationIncludingGravity;
            if (acceleration?.x == null || acceleration.y == null || acceleration.z == null) return;
            const current = { x: acceleration.x, y: acceleration.y, z: acceleration.z };
            const delta = last ? Math.abs(current.x - last.x) + Math.abs(current.y - last.y) + Math.abs(current.z - last.z) : 0;
            last = current;
            const now = Date.now();
            if (delta > SHAKE_THRESHOLD && now - lastShake > SHAKE_INTERVAL_MS) {
                lastShake = now;
                tossRef.current();
            }
        };
        motionHandler.current = handler;
        window.addEventListener('devicemotion', handler);
        setShakeEnabled(true);
    };

    const coinsLabel = pending
        ? '铜钱正在落下'
        : lastResult
            ? `三枚铜钱：${lastResult.coins.map((back) => (back ? '背' : '字')).join('、')}`
            : '三枚铜钱，尚未抛掷';

    return (
        <section className="@container overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface">
            <div className="grid @2xl:grid-cols-2">
                <div className="flex flex-col items-center gap-4 px-5 pb-5 pt-6 @2xl:justify-center @2xl:gap-6 @2xl:border-r-[0.5px] @2xl:border-border @2xl:px-8 @2xl:py-12">
                    <div role="img" aria-label={coinsLabel} className="liuyao-tray flex aspect-[16/10] w-full max-w-[17rem] items-center justify-center gap-3 @2xl:max-w-[21rem] rounded-[50%] @2xl:gap-4">
                        {COIN_LAYOUT.map((layout, index) => (
                            <CopperCoin
                                key={`${index}-${tossCount}`}
                                back={shown?.coins[index] ?? false}
                                fromBack={pending ? (lastResult?.coins[index] ?? false) : false}
                                tossing={Boolean(pending)}
                                tilt={layout.tilt}
                                delayMs={layout.delayMs}
                                spins={layout.spins}
                                className={`[--coin-size:4rem] @2xl:[--coin-size:5rem] ${layout.offset}`}
                            />
                        ))}
                    </div>

                    <p aria-live="polite" className="flex min-h-6 flex-wrap items-baseline justify-center gap-x-2 text-center text-sm text-foreground-secondary">
                        {!cast ? (
                            <span>合掌默念所问之事，再掷铜钱</span>
                        ) : (
                            <span className={`inline-flex items-baseline gap-2 ${pending ? 'invisible' : ''}`}>
                                <span>{cast.faces}</span>
                                <span className="font-display text-base text-foreground">{cast.name}</span>
                                <span className={shown?.isChanging ? 'font-medium text-accent-strong' : ''}>
                                    {cast.yao}{shown?.isChanging && '，动'}
                                </span>
                            </span>
                        )}
                    </p>

                    {isComplete ? (
                        <div role="status" className="flex h-[2.375rem] items-center gap-2 text-sm font-medium text-accent">
                            <SoundWaveLoader variant="inline" />
                            卦成，正在排盘
                        </div>
                    ) : (
                        <Button
                            size="lg"
                            onClick={toss}
                            disabled={disabled}
                            loading={Boolean(pending)}
                            loadingText="铜钱落下"
                            className="min-w-[9.5rem] px-6"
                        >
                            掷{YAO_NAMES[results.length]}爻
                        </Button>
                    )}

                    {!isComplete && shakeSupported && (
                        <div className="-mt-2 flex items-center md:hidden">
                            {shakeEnabled ? (
                                <span className="flex items-center gap-1.5 text-xs text-success">
                                    <Smartphone className="h-3.5 w-3.5" />
                                    已开启摇一摇，摇动手机即可掷钱
                                </span>
                            ) : (
                                <Button variant="ghost" size="sm" onClick={() => void enableShake()}>
                                    <Smartphone className="h-3.5 w-3.5" />
                                    改用摇一摇
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3 border-t-[0.5px] border-border px-3 py-5 @2xl:gap-4 @2xl:border-t-0 @2xl:px-8 @2xl:py-10">
                    <div className="flex items-baseline justify-between gap-3 px-2.5">
                        <h2 className="font-display text-lg leading-snug">
                            {title?.base ? (
                                <>
                                    {title.base}
                                    {title.changed && <> <span className="text-sm text-foreground-secondary">之</span> {title.changed}</>}
                                </>
                            ) : '卦象'}
                        </h2>
                        <span className="text-xs tabular-nums text-foreground-secondary">已掷 {results.length} / 6</span>
                    </div>

                    <ol className="flex flex-col gap-0.5 @2xl:gap-1" aria-label="六爻，自上爻至初爻">
                        {POSITIONS_DESC.map((position) => {
                            const result = results[position - 1];
                            const isNext = !isComplete && position === results.length + 1;
                            const record = result ? CASTS[result.heads] : undefined;
                            return (
                                <li
                                    key={position}
                                    className={`grid h-8 grid-cols-[2.25rem_minmax(0,10rem)_1rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-2.5 transition-colors @2xl:h-10 ${isNext ? 'bg-accent-light' : ''}`}
                                >
                                    <span className={`text-xs ${isNext ? 'font-medium text-accent-strong' : result ? 'text-foreground-secondary' : 'text-foreground-tertiary'}`}>
                                        {YAO_NAMES[position - 1]}爻
                                    </span>
                                    <CastLine result={result} />
                                    <span className="text-center text-sm text-accent">
                                        {result?.isChanging && (
                                            <>
                                                <span aria-hidden="true">{result.yaoType === 1 ? '○' : '×'}</span>
                                                <span className="sr-only">动爻</span>
                                            </>
                                        )}
                                    </span>
                                    <span className="flex items-baseline gap-1.5 text-xs text-foreground-secondary">
                                        {record ? (
                                            <>
                                                <span className={`font-display text-sm ${result?.isChanging ? 'text-accent-strong' : 'text-foreground'}`}>{record.name}</span>
                                                {record.yao}
                                            </>
                                        ) : isNext ? (
                                            <span className="text-accent-strong">{pending ? '落钱中' : '待掷'}</span>
                                        ) : null}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>

                    <p className="px-2.5 text-xs leading-relaxed text-foreground-tertiary">
                        第一掷为初爻，自下而上。重为老阳 ○、交为老阴 ×，二者为动爻。
                    </p>
                </div>
            </div>
        </section>
    );
}
