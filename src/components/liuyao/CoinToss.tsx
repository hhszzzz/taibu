/**
 * 铜钱起卦组件
 * 
 * 模拟抛掷三枚铜钱，生成六爻
 * 支持点击按钮和摇动手机两种方式触发
 */
'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Coins, RotateCw, Smartphone } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { tossThreeCoins, type CoinTossResult, type Yao } from '@/lib/divination/liuyao';

interface CoinTossProps {
    onComplete: (yaos: Yao[], results: CoinTossResult[]) => void;
    disabled?: boolean;
}

// 摇动检测配置
const SHAKE_THRESHOLD = 15; // 加速度阈值
const SHAKE_TIMEOUT = 1500; // 两次摇动之间的最小间隔（ms），防止快速摇动触发多次
const ANIMATION_DURATION = 600; // 摇卦动画时长（ms）

const YAO_LABELS = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
const YAO_POSITIONS_DESC = [6, 5, 4, 3, 2, 1] as const;

export function CoinToss({ onComplete, disabled = false }: CoinTossProps) {
    const [currentLine, setCurrentLine] = useState(0);  // 0-5, 当前第几爻
    const [results, setResults] = useState<CoinTossResult[]>([]);
    const [isAnimating, setIsAnimating] = useState(false);
    const [yaos, setYaos] = useState<Yao[]>([]);
    const [shakeEnabled, setShakeEnabled] = useState(false); // 是否支持摇动检测

    // 用于防抖的 ref
    const lastShakeTime = useRef(0);
    const isAnimatingRef = useRef(false);
    const currentLineRef = useRef(0);
    const resultsRef = useRef<CoinTossResult[]>([]);

    // 同步 ref 与 state
    useEffect(() => {
        isAnimatingRef.current = isAnimating;
    }, [isAnimating]);

    useEffect(() => {
        currentLineRef.current = currentLine;
    }, [currentLine]);

    useEffect(() => {
        resultsRef.current = results;
    }, [results]);

    const [shakeSupported, setShakeSupported] = useState(false); // 设备是否支持摇动
    const handleMotionRef = useRef<((event: DeviceMotionEvent) => void) | null>(null);

    // 检测设备是否支持摇动
    useEffect(() => {
        if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only capability detection
            setShakeSupported(true);
        }
    }, []);

    // 摇动检测处理函数
    useEffect(() => {
        if (disabled) return;

        let lastX = 0, lastY = 0, lastZ = 0;

        handleMotionRef.current = (event: DeviceMotionEvent) => {
            const { accelerationIncludingGravity } = event;
            if (!accelerationIncludingGravity) return;

            const { x, y, z } = accelerationIncludingGravity;
            if (x === null || y === null || z === null) return;

            // 计算加速度变化
            const deltaX = Math.abs(x - lastX);
            const deltaY = Math.abs(y - lastY);
            const deltaZ = Math.abs(z - lastZ);

            lastX = x;
            lastY = y;
            lastZ = z;

            // 检测是否摇动
            const totalAcceleration = deltaX + deltaY + deltaZ;
            const now = Date.now();

            if (totalAcceleration > SHAKE_THRESHOLD &&
                now - lastShakeTime.current > SHAKE_TIMEOUT &&
                !isAnimatingRef.current &&
                currentLineRef.current < 6) {

                lastShakeTime.current = now;

                // 根据当前状态决定调用哪个函数
                if (resultsRef.current.length > currentLineRef.current && currentLineRef.current < 5) {
                    window.dispatchEvent(new CustomEvent('shakeDetected', { detail: 'next' }));
                } else if (resultsRef.current.length <= currentLineRef.current) {
                    window.dispatchEvent(new CustomEvent('shakeDetected', { detail: 'toss' }));
                }
            }
        };

        return () => {
            if (handleMotionRef.current) {
                window.removeEventListener('devicemotion', handleMotionRef.current);
            }
        };
    }, [disabled]);

    // 启用摇动检测 - 必须由用户点击触发
    const enableShakeDetection = useCallback(async () => {
        if (!handleMotionRef.current) return;

        try {
            // @ts-expect-error - DeviceMotionEvent.requestPermission 是 iOS 特有的
            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                // iOS 13+ 需要请求权限
                // @ts-expect-error - DeviceMotionEvent.requestPermission 是 iOS 特有的
                const permission = await DeviceMotionEvent.requestPermission();
                if (permission === 'granted') {
                    window.addEventListener('devicemotion', handleMotionRef.current);
                    setShakeEnabled(true);
                } else {
                    console.log('DeviceMotion permission denied');
                }
            } else {
                // Android 和其他设备不需要权限
                window.addEventListener('devicemotion', handleMotionRef.current);
                setShakeEnabled(true);
            }
        } catch (e) {
            console.error('Failed to enable shake detection:', e);
        }
    }, []);

    // 监听摇动事件
    useEffect(() => {
        const handleShake = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail === 'next') {
                // 模拟点击"继续摇卦"按钮
                const nextButton = document.querySelector('[data-shake-next]') as HTMLButtonElement;
                if (nextButton && !nextButton.disabled) {
                    nextButton.click();
                }
            } else if (customEvent.detail === 'toss') {
                // 模拟点击"抛掷铜钱"按钮
                const tossButton = document.querySelector('[data-shake-toss]') as HTMLButtonElement;
                if (tossButton && !tossButton.disabled) {
                    tossButton.click();
                }
            }
        };

        window.addEventListener('shakeDetected', handleShake);
        return () => {
            window.removeEventListener('shakeDetected', handleShake);
        };
    }, []);

    const toss = useCallback(() => {
        if (currentLine >= 6 || isAnimating || disabled) return;

        // 立即更新 ref，防止摇动连续触发
        isAnimatingRef.current = true;
        setIsAnimating(true);

        // 振动反馈（移动端）
        if ('vibrate' in navigator) {
            navigator.vibrate(50);
        }

        // 模拟抛掷动画延迟
        setTimeout(() => {
            const result = tossThreeCoins();
            const newYao: Yao = {
                type: result.yaoType,
                change: result.isChanging ? 'changing' : 'stable',
                position: currentLine + 1,
            };

            const newResults = [...results, result];
            const newYaos = [...yaos, newYao];

            setResults(newResults);
            setYaos(newYaos);
            setIsAnimating(false);

            // 完成所有6爸
            if (currentLine + 1 === 6) {
                onComplete(newYaos, newResults);
            }
        }, ANIMATION_DURATION);
    }, [currentLine, isAnimating, disabled, results, yaos, onComplete]);

    // 点击按钮前进到下一爸并立即开始摇
    const goToNextAndToss = useCallback(() => {
        if (currentLine < 5 && results.length > currentLine) {
            // 立即更新 ref，防止摇动连续触发
            isAnimatingRef.current = true;
            setCurrentLine(currentLine + 1);
            // 延迟一小段时间后自动开始摇
            setTimeout(() => {
                setIsAnimating(true);

                // 振动反馈（移动端）
                if ('vibrate' in navigator) {
                    navigator.vibrate(50);
                }

                setTimeout(() => {
                    const result = tossThreeCoins();
                    const newYao: Yao = {
                        type: result.yaoType,
                        change: result.isChanging ? 'changing' : 'stable',
                        position: currentLine + 2,
                    };
                    const newResults = [...results, result];
                    const newYaos = [...yaos, newYao];
                    setResults(newResults);
                    setYaos(newYaos);
                    setIsAnimating(false);

                    if (currentLine + 2 === 6) {
                        onComplete(newYaos, newResults);
                    }
                }, ANIMATION_DURATION);
            }, 100);
        }
    }, [currentLine, results, yaos, onComplete]);

    const reset = useCallback(() => {
        setCurrentLine(0);
        setResults([]);
        setYaos([]);
        setIsAnimating(false);
    }, []);

    const isComplete = results.length >= 6;
    const isFinalizing = isAnimating && currentLine === 5 && results.length === 5;

    // 显示最近一次摇卦结果
    const lastResult = results.length > 0 ? results[results.length - 1] : null;
    const showCoinResult = !isAnimating && lastResult && results.length > currentLine;
    const yaoByPosition = useMemo(() => {
        const map = new Map<number, Yao>();
        for (const yao of yaos) {
            map.set(yao.position, yao);
        }
        return map;
    }, [yaos]);

    return (
        <div className="flex flex-col items-center gap-4 md:gap-6">
            {/* 当前爻标签
            {!isComplete && (
                <p className="text-lg font-medium text-foreground">
                    {YAO_LABELS[currentLine]}
                </p>
            )} */}

            {/* 铜钱显示 */}
            <div className="flex gap-2 md:gap-4">
                {[0, 1, 2].map((coinIndex) => (
                    <div
                        key={coinIndex}
                        className={`flex h-14 w-14 items-center justify-center rounded-full border-[3px] transition-all duration-500 md:h-16 md:w-16
                            ${isAnimating
                                ? 'animate-spin border-accent bg-accent-soft'
                                : showCoinResult
                                    ? lastResult!.coins[coinIndex]
                                        ? 'border-earth bg-earth-soft text-earth'
                                        : 'border-border-hover bg-background-secondary text-foreground-secondary'
                                    : 'border-border-hover bg-background-secondary'
                            }`}
                    >
                        {showCoinResult ? (
                            <span className="font-display text-base md:text-lg">
                                {lastResult!.coins[coinIndex] ? '字' : '花'}
                            </span>
                        ) : (
                            <span className="h-3 w-3 border-[1.5px] border-current opacity-40" aria-hidden="true" />
                        )}
                    </div>
                ))}
            </div>

            {/* 最近结果（预留高度，避免抖动） */}
            <div className="text-center min-h-[20px]">
                {lastResult ? (
                    <p className={`text-sm text-foreground-secondary ${isAnimating ? 'invisible' : ''}`}>
                        {lastResult.heads}正{3 - lastResult.heads}反 →
                        <span className={lastResult.isChanging ? 'font-medium text-accent' : ''}>
                            {lastResult.yaoType === 1 ? '阳爻' : '阴爻'}
                            {lastResult.isChanging && '（变）'}
                        </span>
                    </p>
                ) : (
                    <p className="text-sm text-foreground-secondary invisible">占位</p>
                )}
            </div>

            {/* 六爻（预留 6 行，避免布局抖动） */}
            <div className="flex flex-col gap-1 mt-4">
                {YAO_POSITIONS_DESC.map((position) => {
                    const yao = yaoByPosition.get(position);
                    const isPlaceholder = !yao;
                    return (
                        <div key={position} className="flex items-center gap-2 h-5">
                            <span className={`text-xs w-10 ${yao?.change === 'changing'
                                ? 'text-accent'
                                : isPlaceholder
                                    ? 'text-foreground-tertiary'
                                    : 'text-foreground-secondary'
                                }`}>
                                {YAO_LABELS[position - 1]}
                            </span>
                            <div className={`flex items-center ${yao?.change === 'changing' ? 'text-accent' : ''}`}>
                                {!yao ? (
                                    <div className="h-2 w-[88px] rounded-[3px] bg-background-tertiary" />
                                ) : yao.type === 1 ? (
                                    <div className={`h-2 w-[88px] rounded-[3px] ${yao.change === 'changing' ? 'bg-accent' : 'bg-foreground'}`} />
                                ) : (
                                    <>
                                        <div className={`h-2 w-[40px] rounded-[3px] ${yao.change === 'changing' ? 'bg-accent' : 'bg-foreground'}`} />
                                        <div className="w-2" />
                                        <div className={`h-2 w-[40px] rounded-[3px] ${yao.change === 'changing' ? 'bg-accent' : 'bg-foreground'}`} />
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3 mt-2 md:mt-4">
                {!isComplete ? (
                    isFinalizing ? (
                        <div className="flex items-center gap-2 text-foreground-secondary">
                            <SoundWaveLoader variant="inline" />
                            <span className="text-sm">生成卦象中...</span>
                        </div>
                    ) : results.length > currentLine ? (
                        // 已摇完当前爸，显示“继续摇卦”按钮
                        <button
                            onClick={goToNextAndToss}
                            disabled={isAnimating}
                            data-shake-next
                            className="flex h-12 items-center gap-2 rounded-xl bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Coins className="w-5 h-5" />
                            继续摇卦
                        </button>
                    ) : (
                        // 未摇当前爸，显示“抛掷铜钱”按钮
                        <button
                            onClick={toss}
                            disabled={isAnimating || disabled}
                            data-shake-toss
                            className="flex h-12 items-center gap-2 rounded-xl bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Coins className={`w-5 h-5 ${isAnimating ? 'animate-bounce' : ''}`} />
                            {isAnimating ? '抛掷中...' : '抛掷铜钱'}
                        </button>
                    )
                ) : (
                    <button
                        onClick={reset}
                        className="flex h-12 items-center gap-2 rounded-xl border-[0.5px] border-border-hover bg-surface px-6 text-foreground transition-colors hover:bg-background-secondary"
                    >
                        <RotateCw className="w-5 h-5" />
                        重新起卦
                    </button>
                )}
            </div>

            {/* 摇动手机提示 - 仅在移动端显示，更紧凑 */}
            {!isComplete && shakeSupported && (
                <div className="flex md:hidden items-center gap-1.5 text-foreground-secondary text-xs mt-1">
                    {shakeEnabled ? (
                        <>
                            <Smartphone className="w-3 h-3 text-success" />
                            <span className="text-success">摇动摇卦已启用</span>
                        </>
                    ) : (
                        <button
                            onClick={enableShakeDetection}
                            className="flex items-center gap-[6px] rounded-lg px-3 py-1.5 text-xs text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
                        >
                            <Smartphone className="w-3 h-3" />
                            点击启用摇动
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
