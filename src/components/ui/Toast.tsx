/**
 * Toast 通知组件
 * 
 * 用于替代浏览器 alert，提供更好的 UX
 */
'use client';

import { useState, createContext, useContext, useCallback, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X, BotMessageSquare, TriangleAlert } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning' | 'chat';

interface ToastAction {
    label: string;
    onClick: () => void;
}

interface ToastOptions {
    duration?: number;
    action?: ToastAction;
}

interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
    action?: ToastAction;
}

interface ToastContextType {
    showToast: (type: ToastType, message: string, durationOrOptions?: number | ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function normalizeToastOptions(durationOrOptions?: number | ToastOptions): ToastOptions {
    if (typeof durationOrOptions === 'number') {
        return { duration: durationOrOptions };
    }
    return durationOrOptions || {};
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        // 默认 no-op，避免退化为原生 alert 破坏统一交互
        return {
            showToast: ((_type: ToastType, message: string) => {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('[Toast] ToastProvider is missing, dropped message:', message);
                }
            }) as ToastContextType['showToast']
        };
    }
    return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((type: ToastType, message: string, durationOrOptions?: number | ToastOptions) => {
        const normalized = normalizeToastOptions(durationOrOptions);
        const duration = normalized.duration ?? 3000;
        const id = `${Date.now()}-${Math.random()}`;
        setToasts(prev => [...prev, { id, type, message, duration, action: normalized.action }]);

        if (duration > 0) {
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, duration);
        }
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}

            {/* Toast 容器：按内容定宽并以视口为上限，避免 left-1/2 把可用宽度压到半屏导致窄屏折行。
                常驻的 live region 让读屏软件播报新提示；错误提示单独用 role="alert" 立即打断。 */}
            <div
                aria-live="polite"
                className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex w-max max-w-[calc(100vw-2rem)] flex-col items-center gap-2 pointer-events-none"
            >
                {toasts.map(toast => (
                    <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

const TOAST_ICONS: Record<ToastType, { icon: typeof CheckCircle2; className: string }> = {
    success: { icon: CheckCircle2, className: 'text-success' },
    error: { icon: AlertCircle, className: 'text-danger' },
    warning: { icon: TriangleAlert, className: 'text-warning' },
    info: { icon: Info, className: 'text-accent' },
    chat: { icon: BotMessageSquare, className: 'text-accent' },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
    const { icon: Icon, className: iconClassName } = TOAST_ICONS[toast.type];

    return (
        <div
            role={toast.type === 'error' ? 'alert' : undefined}
            className="pointer-events-auto flex min-h-11 items-center gap-2.5 rounded-xl border-[0.5px] border-border bg-surface py-2 pr-2 pl-3.5 shadow-[0_8px_28px_rgba(31,30,29,0.12)] animate-fade-in dark:shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
        >
            <Icon className={`h-[18px] w-[18px] shrink-0 ${iconClassName}`} aria-hidden="true" />
            <span className="text-sm leading-snug text-foreground">{toast.message}</span>
            {toast.action && (
                <button
                    type="button"
                    onClick={() => {
                        toast.action?.onClick();
                        onRemove(toast.id);
                    }}
                    className="ml-1 h-7 shrink-0 rounded-md px-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft"
                >
                    {toast.action.label}
                </button>
            )}
            <button
                type="button"
                onClick={() => onRemove(toast.id)}
                aria-label="关闭提示"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-tertiary transition-colors hover:bg-background-secondary hover:text-foreground"
            >
                <X className="h-4 w-4" aria-hidden="true" />
            </button>
        </div>
    );
}
