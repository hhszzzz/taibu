'use client';

/**
 * 入场动效只给「真正新出现」的条目：新消息、新步骤、新标签。
 *
 * 纯 CSS 入场动画在元素每次挂载时都会重放：消息 id 从临时换成正式、虚拟列表滚回视野、
 * 列表刷新重排、面板随会话切换重新挂载，都会让旧内容再闪一遍。这里按逻辑 key
 * （`data-motion-key`）记住已经出现过的条目，同一 key 重新挂载不再播放；作用域切换
 * 或内容尚未就绪时只记录、不播放，所以打开旧对话不会整页闪一遍。
 *
 * 时长与缓动对应 globals.css「动效体系」的 --duration-* / --ease-*。
 */
import { useEffect, type RefObject } from 'react';

export const MOTION_EASE_OUT = 'cubic-bezier(.165, .84, .44, 1)';
export const MOTION_EASE_SNAP = 'cubic-bezier(.32, .72, 0, 1)';
export const MOTION_EASE_OVERSHOOT = 'cubic-bezier(.34, 1.3, .64, 1)';

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ENTRANCE_PRESETS = {
    /** 新消息、新步骤：淡入并上移几像素。 */
    fadeUp: { keyframes: [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }], options: { duration: 200, easing: MOTION_EASE_OUT } },
    /** 标签、徽标：从 96% 弹到原大小。 */
    pop: { keyframes: [{ opacity: 0, scale: '.96' }, { opacity: 1, scale: '1' }], options: { duration: 200, easing: MOTION_EASE_OVERSHOOT } },
    fade: { keyframes: [{ opacity: 0 }, { opacity: 1 }], options: { duration: 200, easing: MOTION_EASE_OUT } },
} satisfies Record<string, { keyframes: Keyframe[]; options: KeyframeAnimationOptions }>;

export type EntrancePreset = keyof typeof ENTRANCE_PRESETS;

export function playEntrance(element: Element, preset: EntrancePreset = 'fadeUp') {
    if (prefersReducedMotion()) return;
    const { keyframes, options } = ENTRANCE_PRESETS[preset];
    element.animate(keyframes, options);
}

/**
 * Plays `preset` on each element under `ref` that matches `selector` and carries a `data-motion-key` not seen before
 * in this `scope`. What is there when the scope starts, or arrives while `ready` is false, is only recorded.
 */
export function useEntranceMotion(ref: RefObject<Element | null>, { selector, preset = 'fadeUp', scope = '', ready = true }: {
    selector: string;
    preset?: EntrancePreset;
    scope?: string;
    ready?: boolean;
}) {
    useEffect(() => {
        const root = ref.current;
        if (!root) return;
        const seen = new Set<string>();
        const collect = (play: boolean) => {
            for (const element of root.querySelectorAll(selector)) {
                const key = element.getAttribute('data-motion-key');
                if (key === null || seen.has(key)) continue;
                seen.add(key);
                if (play) playEntrance(element, preset);
            }
        };
        collect(false);
        if (!ready) return;
        const observer = new MutationObserver(() => collect(true));
        observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [ref, selector, preset, scope, ready]);
}
