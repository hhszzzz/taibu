'use client';

import { useState, useEffect } from 'react';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { Eye, EyeOff } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { sendOTP, verifyOTP } from '@/lib/auth';
import { supabase } from '@/lib/auth';
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
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (updateError) {
                setError('密码修改失败：' + updateError.message);
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
                    <button type="button" onClick={handleSendCode} disabled={loading || sent} className="settings-button">
                        {loading && !sent ? <SoundWaveLoader variant="inline" /> : null}
                        {sent ? '已发送' : '发送验证码'}
                    </button>
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
                        <button
                            type="button"
                            onClick={handleVerifyCode}
                            disabled={loading || verificationCode.length !== 6}
                            className="settings-button settings-button-primary"
                        >
                            {loading && <SoundWaveLoader variant="inline" />}
                            验证
                        </button>
                        <button
                            type="button"
                            onClick={handleResendCode}
                            disabled={countdown > 0 || loading}
                            className="h-10 px-1 text-[13px] text-accent disabled:cursor-not-allowed disabled:text-foreground-tertiary"
                        >
                            {countdown > 0 ? `重新发送（${countdown} 秒）` : '重新发送验证码'}
                        </button>
                        <button type="button" onClick={resetForm} className="ml-auto h-10 rounded-[10px] px-3 text-sm text-foreground-secondary hover:bg-background-secondary">
                            取消
                        </button>
                    </div>
                </div>
            )}

            {step === 'set-password' && (
                <div className="settings-card mt-1 space-y-4">
                    <p className="text-sm text-foreground-secondary">身份验证成功，请设置新密码</p>

                    <div className="space-y-2">
                        <label htmlFor="settings-new-password" className="text-[13px] text-foreground-secondary">新密码</label>
                        <div className="relative">
                            <input
                                id="settings-new-password"
                                type={showNewPassword ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="设置新密码"
                                className="settings-input settings-input-with-action w-full"
                            />
                            <button
                                type="button"
                                aria-label={showNewPassword ? '隐藏密码' : '显示密码'}
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-secondary transition-colors hover:text-foreground"
                            >
                                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                        </div>
                        <PasswordStrengthIndicator password={newPassword} />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="settings-confirm-password" className="text-[13px] text-foreground-secondary">确认新密码</label>
                        <div className="relative">
                            <input
                                id="settings-confirm-password"
                                type={showConfirmPassword ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="再次输入新密码"
                                aria-invalid={!!confirmPassword && newPassword !== confirmPassword}
                                className="settings-input settings-input-with-action w-full"
                            />
                            <button
                                type="button"
                                aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-secondary transition-colors hover:text-foreground"
                            >
                                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                        </div>
                        {confirmPassword && newPassword !== confirmPassword && (
                            <p className="text-xs text-danger">两次输入的密码不一致</p>
                        )}
                    </div>

                    {message}

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={handleChangePassword}
                            disabled={loading || !newPassword || !confirmPassword}
                            className="settings-button settings-button-primary"
                        >
                            {loading && <SoundWaveLoader variant="inline" />}
                            确认修改
                        </button>
                        <button type="button" onClick={resetForm} className="ml-auto h-10 rounded-[10px] px-3 text-sm text-foreground-secondary hover:bg-background-secondary">
                            取消
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
