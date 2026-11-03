/**
 * 新功能推荐卡：可左右切换的多条功能，支持「不再提示」。
 *
 * 卡片只负责展示与切换；哪些功能该出现由调用方决定。只有「不再显示」
 * 会永久隐藏，体验过某项功能也不自动移除。
 */
'use client';

import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import './feature-promo.css';

export interface FeaturePromoItem {
    id: string;
    title: string;
    description: string;
    actionLabel: string;
    onAction: () => void;
    icon?: ReactNode;
}

export function FeaturePromoCarousel({ items, storageKey, className }: {
    items: readonly FeaturePromoItem[];
    /** 每个用户一份：${storageKey}:dismissed 记录「不再提示」。 */
    storageKey: string;
    className?: string;
}) {
    const [index, setIndex] = useState(0);
    const [dismissedNow, setDismissedNow] = useState(false);
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
    const dismissed = dismissedNow || storedDismissed;

    if (dismissed || items.length === 0) return null;

    const activeIndex = Math.min(index, items.length - 1);
    const item = items[activeIndex];
    const step = (delta: number) => setIndex(current => (current + delta + items.length) % items.length);
    const dismiss = () => {
        try { localStorage.setItem(storageKeyOfDismissal, '1'); } catch { /* optional */ }
        setDismissedNow(true);
    };

    return (
        <section
            className={`feature-promo${className ? ` ${className}` : ''}`}
            aria-label="新功能推荐"
            onKeyDown={event => {
                if (items.length < 2) return;
                if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
                if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
            }}
        >
            <div className="feature-promo-body">
                <span className="feature-promo-icon" aria-hidden="true">{item.icon ?? <Sparkles size={16} />}</span>
                <div className="feature-promo-copy">
                    <p className="feature-promo-title">{item.title}</p>
                    <p className="feature-promo-desc">{item.description}</p>
                </div>
                <Button unstyled type="button" className="feature-promo-action"
                    onClick={() => item.onAction()}>
                    {item.actionLabel}
                </Button>
            </div>
            <div className="feature-promo-foot">
                <Button unstyled type="button" className="feature-promo-dismiss" onClick={dismiss}>
                    不再显示
                </Button>
                {items.length > 1 && (
                    <div className="feature-promo-nav">
                        <Button unstyled type="button" className="feature-promo-arrow" aria-label="上一个功能" onClick={() => step(-1)}>
                            <ChevronLeft size={14} aria-hidden="true" />
                        </Button>
                        <span className="feature-promo-dots" aria-hidden="true">
                            {items.map((entry, dotIndex) => <i key={entry.id} data-active={dotIndex === activeIndex || undefined} />)}
                        </span>
                        <Button unstyled type="button" className="feature-promo-arrow" aria-label="下一个功能" onClick={() => step(1)}>
                            <ChevronRight size={14} aria-hidden="true" />
                        </Button>
                    </div>
                )}
            </div>
        </section>
    );
}
