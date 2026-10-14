/**
 * 地点输入模态框组件
 *
 * 'use client' 标记说明：
 * - 使用 useState 管理模态框状态
 * - 包含交互式地点选择
 */
'use client';

import { useState } from 'react';
import { MapPin, X } from 'lucide-react';
import type { BaziFormData } from '@/types';
import { RegionPicker } from '@/components/bazi/form/RegionPicker';

interface PlaceInputModalProps {
    isOpen: boolean;
    onClose: () => void;
    formData: BaziFormData;
    onUpdate: <K extends keyof BaziFormData>(field: K, value: BaziFormData[K]) => void;
}

export function PlaceInputModal({
    isOpen,
    onClose,
    formData,
    onUpdate,
}: PlaceInputModalProps) {
    // 使用 isOpen 作为 key 的一部分，每次打开时重新初始化状态
    const [localPlace, setLocalPlace] = useState(formData.birthPlace || '');

    // 当模态框打开时，同步外部值到本地状态
    // 使用条件初始化而非 useEffect
    const [lastIsOpen, setLastIsOpen] = useState(isOpen);
    if (isOpen && !lastIsOpen) {
        setLocalPlace(formData.birthPlace || '');
    }
    if (isOpen !== lastIsOpen) {
        setLastIsOpen(isOpen);
    }

    const handleConfirm = () => {
        onUpdate('birthPlace', localPlace);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 animate-fade-in">
            {/* 遮罩层 */}
            <div
                className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]"
                onClick={onClose}
            />

            {/* 模态框内容 */}
            <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border-[0.5px] border-border bg-surface text-foreground shadow-lg sm:rounded-2xl">
                {/* 头部 */}
                <div className="flex items-center justify-between border-b-[0.5px] border-border px-5 py-4 sm:px-6">
                    <h2 className="flex items-center gap-2 font-display text-lg">
                        <MapPin className="h-[18px] w-[18px] text-clay" />
                        出生地点
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="关闭"
                        className="rounded-lg p-1.5 text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary hover:text-foreground"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* 内容 */}
                <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
                    {/* 省市区选择 */}
                    <RegionPicker
                        value={localPlace}
                        onChange={setLocalPlace}
                    />

                    {/* 说明 */}
                    <div className="flex items-start gap-3 rounded-xl bg-panel p-4 text-xs text-foreground-secondary">
                        <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-clay" />
                        <p className="leading-relaxed">
                            出生地点会在提交时通过高德 Web 服务解析经度，用于真太阳时修正。如果无法精确解析到城市或区县，系统会自动回退为北京时间（东八区）排盘。
                        </p>
                    </div>
                </div>

                {/* 底部按钮 */}
                <div className="flex gap-3 border-t-[0.5px] border-border bg-surface px-5 py-4 pb-[calc(1rem+var(--sab))] sm:px-6 sm:pb-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-11 flex-1 rounded-xl border-[0.5px] border-border-hover bg-surface text-sm font-medium text-foreground
                            transition-colors duration-150 hover:bg-background-secondary active:bg-background-tertiary"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        className="h-11 flex-1 rounded-xl bg-accent text-sm font-medium text-on-accent
                            transition-colors duration-150 hover:bg-accent-hover"
                    >
                        确定
                    </button>
                </div>
            </div>
        </div>
    );
}
