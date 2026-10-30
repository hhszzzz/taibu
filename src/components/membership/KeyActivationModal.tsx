/**
 * Key激活弹窗组件
 * 
 * 用户输入激活码来激活会员或获得积分
 */
'use client';

import { useState } from 'react';
import { X, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { Dialog } from '@/components/ui/Dialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { dispatchApiWriteEvents } from '@/lib/browser-api';
import { getMembershipInfo, type MembershipInfo } from '@/lib/user/membership';

interface KeyActivationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (info: MembershipInfo | null) => void;
}

type ActivationStep = 'input' | 'processing' | 'success' | 'error';

interface ActivationResult {
    keyType?: 'membership' | 'credits';
    membershipType?: string;
    creditsAmount?: number;
}

export function KeyActivationModal({
    isOpen,
    onClose,
    onSuccess,
}: KeyActivationModalProps) {
    const { user } = useSessionSafe();
    const [step, setStep] = useState<ActivationStep>('input');
    const [keyCode, setKeyCode] = useState('');
    const [error, setError] = useState('');
    const [result, setResult] = useState<ActivationResult | null>(null);

    if (!isOpen) return null;

    const handleActivate = async () => {
        const trimmedKey = keyCode.trim();

        if (!trimmedKey) {
            setError('请输入激活码');
            return;
        }

        if (!trimmedKey.startsWith('sk-')) {
            setError('激活码格式错误，应以 sk- 开头');
            return;
        }

        setError('');
        setStep('processing');

        try {
            if (!user) {
                setError('请先登录');
                setStep('input');
                return;
            }

            const response = await fetch('/api/activation-keys', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'activate',
                    keyCode: trimmedKey,
                }),
            });

            const data = await response.json();

            if (data.success) {
                dispatchApiWriteEvents('/api/activation-keys', 'POST');
                setResult({
                    keyType: data.keyType,
                    membershipType: data.membershipType,
                    creditsAmount: data.creditsAmount,
                });
                let membershipInfo: MembershipInfo | null = null;
                const membershipResult = await getMembershipInfo(user.id);
                if (membershipResult.ok) {
                    membershipInfo = membershipResult.info;
                } else {
                    console.error('Activation succeeded but membership refresh failed:', membershipResult.error);
                }
                onSuccess?.(membershipInfo);
                setStep('success');
                setTimeout(() => {
                    handleClose();
                }, 2000);
            } else {
                setError(data.error || '激活失败');
                setStep('error');
            }
        } catch (err) {
            console.error('Activation error:', err);
            setError('网络错误，请重试');
            setStep('error');
        }
    };

    const handleClose = () => {
        if (step !== 'processing') {
            setStep('input');
            setKeyCode('');
            setError('');
            setResult(null);
            onClose();
        }
    };

    const handleRetry = () => {
        setStep('input');
        setError('');
    };

    const getSuccessMessage = () => {
        if (!result) return '激活成功';
        if (result.keyType === 'membership') {
            const name = result.membershipType === 'plus' ? 'Plus' : 'Pro';
            return `已成功开通 ${name} 会员`;
        }
        return `已获得 ${result.creditsAmount} 积分`;
    };

    return (
        <Dialog bare open={isOpen} onClose={handleClose} labelledBy="key-activation-title" className="dialog-plain dialog-md">
            {/* 弹窗内容 */}
            <div className="relative w-full bg-background rounded-2xl border border-border shadow-2xl animate-fade-in">
                {/* 头部 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <h2 id="key-activation-title" className="text-xl font-bold">
                            {step === 'success' ? '激活成功' : step === 'error' ? '激活失败' : '激活会员'}
                        </h2>
                    </div>
                    {step !== 'processing' && (
                        <IconButton label="关闭" onClick={handleClose}>
                            <X aria-hidden="true" />
                        </IconButton>
                    )}
                </div>

                <div className="p-6">
                    {/* 成功状态 */}
                    {step === 'success' && (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-8 h-8 text-success" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">激活成功！</h3>
                            <p className="text-foreground-secondary">
                                {getSuccessMessage()}
                            </p>
                        </div>
                    )}

                    {/* 处理中状态 */}
                    {step === 'processing' && (
                        <div className="text-center py-8">
                            <SoundWaveLoader variant="block" />
                            <h3 className="text-xl font-bold mb-2">正在激活</h3>
                            <p className="text-foreground-secondary">
                                请稍候...
                            </p>
                        </div>
                    )}

                    {/* 错误状态 */}
                    {step === 'error' && (
                        <div className="text-center py-6">
                            <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-4">
                                <AlertCircle className="w-8 h-8 text-danger" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">激活失败</h3>
                            <p className="text-danger mb-6">{error}</p>
                            <Button size="lg" onClick={handleRetry}>重新输入</Button>
                        </div>
                    )}

                    {/* 输入状态 */}
                    {step === 'input' && (
                        <>
                            {/* 错误提示 */}
                            {error && (
                                <div className="p-3 rounded-lg bg-danger/10 text-danger text-sm mb-4">
                                    {error}
                                </div>
                            )}

                            {/* 输入框 */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-foreground-secondary mb-2">
                                    激活码
                                </label>
                                <Input
                                    type="text"
                                    value={keyCode}
                                    onChange={(e) => setKeyCode(e.target.value)}
                                    placeholder="sk-xxxxxxxxxxxxxxxx"
                                    className="h-11 bg-background-secondary font-mono"
                                    autoFocus
                                />
                            </div>

                            {/* 激活按钮 */}
                            <Button size="lg" className="w-full" onClick={handleActivate} disabled={!keyCode.trim()}>激活</Button>
                        </>
                    )}
                </div>
            </div>
        </Dialog>
    );
}
