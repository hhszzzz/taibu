/**
 * Toast 通知组件
 * 
 * 用于替代浏览器 alert，提供更好的 UX
 */
'use client';

import { useState, createContext, useContext, useCallback, ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, X, BotMessageSquare } from 'lucide-react';

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

            {/* Toast 容器：按内容定宽并以视口为上限，避免 left-1/2 把可用宽度压到半屏导致窄屏折行 */}
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex w-max max-w-[calc(100vw-2rem)] flex-col gap-2 pointer-events-none">
                {toasts.map(toast => (
                    <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
    const icons = {
        success: <CheckCircle className="w-5 h-5 text-green-500" />,
        error: <AlertCircle className="w-5 h-5 text-red-500" />,
        warning: <AlertCircle className="w-5 h-5 text-yellow-500" />,
        info: <Info className="w-5 h-5 text-blue-500" />,
        chat: <BotMessageSquare className="w-5 h-5 text-cyan-500" />,
    };

    const bgColors = {
        success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
        error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
        warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
        info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
        chat: 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800',
    };

    return (
        <div
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg 
                pointer-events-auto animate-fade-in ${bgColors[toast.type]}`}
        >
            {icons[toast.type]}
            <span className="text-sm text-foreground">{toast.message}</span>
            {toast.action && (
                <button
                    onClick={() => {
                        toast.action?.onClick();
                        onRemove(toast.id);
                    }}
                    className="px-2 py-1 rounded-md text-xs font-medium bg-background/70 dark:bg-black/20 hover:bg-background dark:hover:bg-black/30 transition-colors"
                >
                    {toast.action.label}
                </button>
            )}
            <button
                onClick={() => onRemove(toast.id)}
                className="p-1 hover:bg-black/5 dark:hover:bg-background/5 rounded-full transition-colors"
            >
                <X className="w-4 h-4 text-foreground-secondary" />
            </button>
        </div>
    );
}
