/**
 * 积分不足提示弹窗
 *
 * 当用户积分不足时显示，引导用户前往订阅页面获取积分
 */
'use client';

import { useCallback, useId } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Coins, Crown, X } from 'lucide-react';
import { openSettingsCenter } from '@/lib/settings-center';

interface CreditsModalProps {
    isOpen: boolean;
    onClose: () => void;
    message?: string;
}

export function CreditsModal({ isOpen, onClose, message }: CreditsModalProps) {
    const id = useId();
    const handleGoToUpgrade = useCallback(() => {
        onClose();
        openSettingsCenter('upgrade');
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <Dialog bare open={isOpen} onClose={onClose} labelledBy={id} className="max-w-sm">
                {/* 关闭按钮 */}
                <IconButton label="关闭积分提示" expand="none" className="absolute top-4 right-4" onClick={onClose}><X aria-hidden="true" /></IconButton>

                {/* 图标 */}
                <div className="pt-8 pb-4 flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
                        <Coins className="w-8 h-8 text-warning" />
                    </div>
                </div>

                {/* 标题和描述 */}
                <div className="px-6 pb-4 text-center">
                    <h3 id={id} className="text-lg font-bold text-foreground mb-2">
                        积分不足
                    </h3>
                    <p className="text-sm text-foreground-secondary">
                        {message || '您的积分已用完，请前往订阅页面通过签到、激活码或会员权益继续获取积分'}
                    </p>
                </div>

                {/* 按钮 */}
                <div className="px-6 pb-6 space-y-3">
                    <Button size="lg" className="w-full" onClick={handleGoToUpgrade}>
                        <Crown className="h-5 w-5" aria-hidden="true" />前往订阅
                    </Button>
                    <Button variant="secondary" size="lg" className="w-full" onClick={onClose}>稍后再说</Button>
                </div>
        </Dialog>
    );
}
