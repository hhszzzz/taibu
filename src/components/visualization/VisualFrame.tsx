'use client';

import { useEffect, useRef, useState } from 'react';
import {
    buildVisualSrcdoc,
    clampVisualHeight,
    readVisualTheme,
    VISUAL_FRAME_MIN_HEIGHT,
} from '@/lib/visualization/visual-frame';

export interface VisualFrameProps {
    /** 沙箱里渲染的 HTML 片段（已去掉标题注释）。 */
    html: string;
    /** iframe 的无障碍名称。 */
    title: string;
    /** 全屏时给一个更高的初始下限。 */
    minHeight?: number;
    className?: string;
}

/**
 * ```visual 的渲染壳：sandbox="allow-scripts" 的 srcdoc iframe。
 * 不给 allow-same-origin，内容处于不透明源，读不到站点 Cookie 与存储；
 * 内容变化只换 srcdoc，主题通过 postMessage 推送，不重载。
 */
export default function VisualFrame({ html, title, minHeight, className = '' }: VisualFrameProps) {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(VISUAL_FRAME_MIN_HEIGHT);
    const [themeVersion, setThemeVersion] = useState(0);
    const srcdoc = buildVisualSrcdoc(html);

    // 只接受这个 iframe 发来的高度消息，并限幅。
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== frameRef.current?.contentWindow) return;
            const data = event.data as { type?: unknown; height?: unknown } | null;
            if (!data || data.type !== 'taibu-visual:height') return;
            const next = clampVisualHeight(data.height);
            if (next !== null) setHeight(next);
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    // 主题切换（.dark / data-mode / 系统主题）后把新的 CSS 变量推给沙箱。
    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return;
        const observer = new MutationObserver(() => setThemeVersion(version => version + 1));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame?.contentWindow) return;
        const vars = readVisualTheme();
        if (Object.keys(vars).length) frame.contentWindow.postMessage({ type: 'taibu-visual:theme', vars }, '*');
    }, [themeVersion]);

    return <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        data-visual-frame=""
        className={`visual-frame ${className}`}
        style={{ height: `${Math.max(height, minHeight ?? VISUAL_FRAME_MIN_HEIGHT)}px` }}
        onLoad={() => setThemeVersion(version => version + 1)}
    />;
}
