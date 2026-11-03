/**
 * Beta 新功能弹窗：左侧列出功能，右侧展开说明与入口，支持「不再显示」。
 *
 * 弹窗只负责展示与切换；哪些功能该出现由调用方决定。只有「不再显示」
 * 会永久隐藏，体验过某项功能也不自动移除。
 */
'use client';

import { useCallback, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import './feature-promo.css';

export interface FeaturePromoItem {
    id: string;
    /** 列表里的短名。 */
    label: string;
    title: string;
    description: string;
    /** 三两条能力点，展示在说明下方。 */
    highlights?: readonly string[];
    actionLabel: string;
    onAction: () => void;
    icon?: (size: number) => ReactNode;
}

// 本次打开页面里关过的弹窗：新建对话再回到空态不再弹，刷新或下次访问才会再出现。
const closedThisSession = new Set<string>();

export function FeaturePromoDialog({ items, storageKey, className }: {
    items: readonly FeaturePromoItem[];
    /** 每个用户一份：${storageKey}:dismissed 记录「不再显示」。 */
    storageKey: string;
    className?: string;
}) {
    const baseId = useId();
    const titleId = `${baseId}-title`;
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const [index, setIndex] = useState(0);
    const [dismissedNow, setDismissedNow] = useState(false);
    // Esc、遮罩、右上角关闭或点了入口只收起本次；只有「不再显示」会永久关闭。
    const [closed, setClosedState] = useState(() => closedThisSession.has(storageKey));
    const close = () => { closedThisSession.add(storageKey); setClosedState(true); };
    const storageKeyOfDismissal = `${storageKey}:dismissed`;
    const subscribe = useCallback((onChange: () => void) => {
        window.addEventListener('storage', onChange);
        return () => window.removeEventListener('storage', onChange);
    }, []);
    const readDismissed = useCallback(() => {
        try {
            return localStorage.getItem(storageKeyOfDismissal) === '1';
        } catch {
            return false;
        }
    }, [storageKeyOfDismissal]);
    const storedDismissed = useSyncExternalStore(subscribe, readDismissed, () => false);
    // 打开时焦点落在右侧内容区：条目会在能力加载后补全，焦点不能钉在某一项上。
    const panelRef = useRef<HTMLElement | null>(null);

    if (dismissedNow || storedDismissed || items.length === 0) return null;

    const activeIndex = Math.min(index, items.length - 1);
    const item = items[activeIndex];
    const select = (next: number) => {
        const target = (next + items.length) % items.length;
        setIndex(target);
        tabRefs.current[target]?.focus();
    };
    const onTabKeyDown = (event: KeyboardEvent) => {
        const delta = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
        if (delta) { event.preventDefault(); select(activeIndex + delta); }
        else if (event.key === 'Home') { event.preventDefault(); select(0); }
        else if (event.key === 'End') { event.preventDefault(); select(items.length - 1); }
    };
    const dismiss = () => {
        try { localStorage.setItem(storageKeyOfDismissal, '1'); } catch { /* optional */ }
        setDismissedNow(true);
    };
    const icon = (entry: FeaturePromoItem, size: number) => entry.icon?.(size) ?? <Sparkles size={size} aria-hidden="true" />;

    return (
        <Dialog bare open={!closed} onClose={close} labelledBy={titleId} initialFocusRef={panelRef}
            className={`feature-promo-dialog${className ? ` ${className}` : ''}`}>
            <div className="feature-promo">
                <aside className="feature-promo-rail">
                    <div className="feature-promo-rail-head">
                        <span className="feature-promo-kicker">Beta</span>
                        <p className="feature-promo-rail-title">抢先体验</p>
                        <p className="feature-promo-rail-note">{items.length} 项仍在打磨的新功能</p>
                    </div>
                    <div role="tablist" aria-orientation="vertical" aria-label="Beta 功能" className="feature-promo-tabs">
                        {items.map((entry, position) => {
                            const selected = position === activeIndex;
                            return (
                                <Button unstyled key={entry.id} type="button" role="tab" id={`${baseId}-tab-${entry.id}`}
                                    ref={node => { tabRefs.current[position] = node; }}
                                    aria-selected={selected} aria-controls={`${baseId}-panel`} tabIndex={selected ? 0 : -1}
                                    className="feature-promo-tab" onClick={() => setIndex(position)} onKeyDown={onTabKeyDown}>
                                    <span className="feature-promo-tab-icon">{icon(entry, 18)}</span>
                                    <span className="feature-promo-tab-label">{entry.label}</span>
                                </Button>
                            );
                        })}
                    </div>
                </aside>
                <section ref={panelRef} tabIndex={-1} id={`${baseId}-panel`} role="tabpanel"
                    aria-labelledby={`${baseId}-tab-${item.id}`} className="feature-promo-panel">
                    <div key={item.id} className="feature-promo-panel-body">
                        <div className="feature-promo-art" aria-hidden="true">
                            <span className="feature-promo-art-ring" />
                            <span className="feature-promo-art-ring is-outer" />
                            <span className="feature-promo-mark">{icon(item, 30)}</span>
                        </div>
                        <div className="feature-promo-content">
                            <h2 id={titleId} className="feature-promo-title">{item.title}</h2>
                            <p className="feature-promo-desc">{item.description}</p>
                            {item.highlights?.length ? (
                                <ul className="feature-promo-points">
                                    {item.highlights.map(point => <li key={point}>{point}</li>)}
                                </ul>
                            ) : null}
                        </div>
                        <div className="feature-promo-actions">
                            <Button unstyled type="button" className="feature-promo-dismiss" onClick={dismiss}>不再显示</Button>
                            <Button type="button" className="feature-promo-action" onClick={() => { close(); item.onAction(); }}>
                                {item.actionLabel}
                            </Button>
                        </div>
                    </div>
                </section>
                <Button unstyled type="button" className="feature-promo-close" aria-label="关闭" onClick={close}>
                    <X size={16} aria-hidden="true" />
                </Button>
            </div>
        </Dialog>
    );
}
