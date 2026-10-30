'use client';

import { useState, useEffect } from 'react';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { resetPasswordWithOTP, sendOTP, verifyOTP } from '@/lib/auth';
import { PasswordStrengthIndicator, validatePasswordStrength } from '@/components/auth/PasswordStrengthIndicator';
import { VerificationCodeInput } from '@/components/auth/VerificationCodeInput';
import { SettingsRow } from '@/components/settings/SettingsControls';

type PasswordChangeStep = 'idle' | 'verify' | 'set-password';

export function PasswordSection({
    email,
}: {
    email: string;
}) {
    const [step, setStep] = useState<PasswordChangeStep>('idle');
    const [verificationCode, setVerificationCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [countdown, setCountdown] = useState(0);
    useUnsavedSettingsGuard(!!verificationCode || !!newPassword || !!confirmPassword);

    // 倒计时效果
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown]);

    // 重置状态
    const resetForm = () => {
        setStep('idle');
        setVerificationCode('');
        setNewPassword('');
        setConfirmPassword('');
        setShowNewPassword(false);
        setShowConfirmPassword(false);
        setError('');
        setSuccess('');
    };

    // 发送验证码
    const handleSendCode = async () => {
        if (!email) {
            setError('无法获取邮箱地址');
            return;
        }

        setError('');
        setLoading(true);

        try {
            const result = await sendOTP(email, 'recovery');
            if (result.success) {
                setCountdown(60);
                setStep('verify');
                setSuccess('');
            } else {
                setError(result.error?.message || '发送失败');
            }
        } catch {
            setError('发送失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    // 验证验证码
    const handleVerifyCode = async () => {
        if (!verificationCode || verificationCode.length !== 6) {
            setError('请输入完整的6位验证码');
            return;
        }

        setError('');
        setLoading(true);

        try {
            const result = await verifyOTP(email, verificationCode, 'recovery');
            if (result.success) {
                setStep('set-password');
                setSuccess('验证成功，请设置新密码');
            } else {
                setError(result.error?.message || '验证失败');
            }
        } catch {
            setError('验证失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    // 重新发送验证码
    const handleResendCode = async () => {
        if (countdown > 0) return;
        await handleSendCode();
    };

    // 修改密码
    const handleChangePassword = async () => {
        const { isValid } = validatePasswordStrength(newPassword);
        if (!isValid) {
            setError('密码不符合强度要求');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('两次输入的密码不一致');
            return;
        }

        setError('');
        setLoading(true);

        try {
            const result = await resetPasswordWithOTP(email, verificationCode, newPassword);

            if (!result.success) {
                setError('密码修改失败：' + (result.error?.message || '请重试'));
            } else {
                setSuccess('密码修改成功！');
                setTimeout(() => {
                    resetForm();
                    setSuccess('');
                }, 2000);
            }
        } catch {
            setError('密码修改失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    const sent = step !== 'idle';
    const message = (error || success) ? (
        <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-danger' : 'text-success'}`}>{error || success}</p>
    ) : null;

    return (
        <div>
            <SettingsRow
                label="修改密码"
                description="先向绑定邮箱发送 6 位验证码，验证后设置新密码"
                control={(
                    <Button variant="secondary" loading={loading && !sent} disabled={sent} onClick={handleSendCode}>
                        {sent ? '已发送' : '发送验证码'}
                    </Button>
                )}
            />
            {step === 'idle' && error ? <div className="pt-2">{message}</div> : null}

            {step === 'verify' && (
                <div className="settings-card mt-1 space-y-4">
                    <p className="text-sm text-foreground-secondary">
                        验证码已发送到 <span className="text-foreground">{email}</span>
                    </p>
                    <VerificationCodeInput
                        value={verificationCode}
                        onChange={setVerificationCode}
                        onComplete={handleVerifyCode}
                        length={6}
                        disabled={loading}
                    />
                    {message}
                    <div className="flex flex-wrap items-center gap-3">
                        <Button onClick={handleVerifyCode} loading={loading} disabled={verificationCode.length !== 6}>
                            验证
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={handleResendCode}
                            disabled={countdown > 0 || loading}
                            className="text-accent"
                        >
                            {countdown > 0 ? `重新发送（${countdown} 秒）` : '重新发送验证码'}
                        </Button>
                        <Button variant="ghost" onClick={resetForm} className="ml-auto">
                            取消
                        </Button>
                    </div>
                </div>
            )}

            {step === 'set-password' && (
                <div className="settings-card mt-1 space-y-4">
                    <p className="text-sm text-foreground-secondary">身份验证成功，请设置新密码</p>

                    <div className="space-y-2">
                        <label htmlFor="settings-new-password" className="text-[13px] text-foreground-secondary">新密码</label>
                        <div className="relative">
                            <Input
                                id="settings-new-password"
                                type={showNewPassword ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="设置新密码"
                                className="pr-11"
                            />
                            <IconButton
                                label={showNewPassword ? '隐藏密码' : '显示密码'}
                                size="sm"
                                className="absolute right-2 top-1/2 -translate-y-1/2"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                            >
                                {showNewPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                            </IconButton>
                        </div>
                        <PasswordStrengthIndicator password={newPassword} />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="settings-confirm-password" className="text-[13px] text-foreground-secondary">确认新密码</label>
                        <div className="relative">
                            <Input
                                id="settings-confirm-password"
                                type={showConfirmPassword ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="再次输入新密码"
                                aria-invalid={!!confirmPassword && newPassword !== confirmPassword}
                                className="pr-11"
                            />
                            <IconButton
                                label={showConfirmPassword ? '隐藏密码' : '显示密码'}
                                size="sm"
                                className="absolute right-2 top-1/2 -translate-y-1/2"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            >
                                {showConfirmPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                            </IconButton>
                        </div>
                        {confirmPassword && newPassword !== confirmPassword && (
                            <p className="text-xs text-danger">两次输入的密码不一致</p>
                        )}
                    </div>

                    {message}

                    <div className="flex flex-wrap items-center gap-3">
                        <Button onClick={handleChangePassword} loading={loading} disabled={!newPassword || !confirmPassword}>
                            确认修改
                        </Button>
                        <Button variant="ghost" onClick={resetForm} className="ml-auto">
                            取消
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
