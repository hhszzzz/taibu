'use client';

/**
 * 标签栏的滑动选中块：把当前标签（`[role=tab][aria-selected=true]`）的位置与尺寸写成 CSS 变量
 * （--tab-x / --tab-y / --tab-w / --tab-h），由 globals.css 的 `.motion-tabs::before` 画出选中块并过渡过去。
 * 第一次定位不带过渡（`data-indicator-ready` 在下一帧才挂上），挂载时不会从左上角滑进来。
 * 标签换行、字号档位变化、列表滚动都只改位置，不改选中，所以 ResizeObserver 与属性变化都会重算。
 */
import { useEffect, type RefObject } from 'react';

export function useTabIndicator(ref: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const list = ref.current;
        if (!list) return;
        let frame = 0;
        const place = () => {
            const tab = list.querySelector<HTMLElement>('[role=tab][aria-selected=true]');
            if (!tab || !tab.offsetWidth) { list.removeAttribute('data-indicator'); return; }
            list.style.setProperty('--tab-x', `${tab.offsetLeft}px`);
            list.style.setProperty('--tab-y', `${tab.offsetTop}px`);
            list.style.setProperty('--tab-w', `${tab.offsetWidth}px`);
            list.style.setProperty('--tab-h', `${tab.offsetHeight}px`);
            list.setAttribute('data-indicator', '');
        };
        place();
        frame = requestAnimationFrame(() => list.setAttribute('data-indicator-ready', ''));
        const resize = new ResizeObserver(place);
        resize.observe(list);
        for (const tab of list.querySelectorAll('[role=tab]')) resize.observe(tab);
        const mutations = new MutationObserver(place);
        mutations.observe(list, { attributes: true, attributeFilter: ['aria-selected'], subtree: true, childList: true });
        return () => {
            cancelAnimationFrame(frame);
            resize.disconnect();
            mutations.disconnect();
            list.removeAttribute('data-indicator');
            list.removeAttribute('data-indicator-ready');
        };
    }, [ref]);
}
