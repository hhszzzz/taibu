/**
 * 注册表单字段组件
 *
 * 'use client' 标记说明：
 * - 使用交互状态控制密码可见性
 * - 验证码发送按钮与倒计时
 */
'use client';

import { useId } from 'react';
import { User } from 'lucide-react';
import { PasswordStrengthIndicator } from '@/components/auth/PasswordStrengthIndicator';
import { VerificationCodeInput } from '@/components/auth/VerificationCodeInput';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { EmailField, PasswordField } from '@/components/auth/LoginForm';
import type { RefObject } from 'react';

interface RegisterFormProps {
    nickname: string;
    onNicknameChange: (value: string) => void;
    email: string;
    onEmailChange: (value: string) => void;
    password: string;
    onPasswordChange: (value: string) => void;
    confirmPassword: string;
    onConfirmPasswordChange: (value: string) => void;
    showPassword: boolean;
    onToggleShowPassword: () => void;
    showConfirmPassword: boolean;
    onToggleShowConfirmPassword: () => void;
    verificationCode: string;
    onVerificationCodeChange: (value: string) => void;
    onSendCode: () => void;
    sendingCode: boolean;
    countdown: number;
    emailRef?: RefObject<HTMLInputElement | null>;
}

export function RegisterForm({
    nickname,
    onNicknameChange,
    email,
    onEmailChange,
    password,
    onPasswordChange,
    confirmPassword,
    onConfirmPasswordChange,
    showPassword,
    onToggleShowPassword,
    showConfirmPassword,
    onToggleShowConfirmPassword,
    verificationCode,
    onVerificationCodeChange,
    onSendCode,
    sendingCode,
    countdown,
    emailRef,
}: RegisterFormProps) {
    const nicknameId = useId();
    const confirmMismatch = Boolean(confirmPassword) && password !== confirmPassword;
    return (
        <>
            <div className="auth-field">
                <div className="auth-field-head">
                    <label htmlFor={nicknameId} className="auth-label">昵称</label>
                    <span className="auth-hint">可留空，之后在账户设置里改</span>
                </div>
                <div className="auth-control">
                    <User aria-hidden="true" />
                    <input
                        id={nicknameId}
                        type="text"
                        value={nickname}
                        onChange={(e) => onNicknameChange(e.target.value)}
                        placeholder="怎么称呼你"
                        autoComplete="nickname"
                        maxLength={40}
                    />
                </div>
            </div>

            <EmailField email={email} onEmailChange={onEmailChange} inputRef={emailRef} />

            <PasswordField
                id="register-password"
                label="密码"
                value={password}
                onChange={onPasswordChange}
                show={showPassword}
                onToggleShow={onToggleShowPassword}
                autoComplete="new-password"
                minLength={8}
                placeholder="设置密码"
                hint={<PasswordStrengthIndicator password={password} />}
            />

            <PasswordField
                id="register-confirm-password"
                label="确认密码"
                value={confirmPassword}
                onChange={onConfirmPasswordChange}
                show={showConfirmPassword}
                onToggleShow={onToggleShowConfirmPassword}
                autoComplete="new-password"
                minLength={8}
                placeholder="再次输入密码"
                error={confirmMismatch ? '两次输入的密码不一致' : undefined}
            />

            {/* 验证码：先填邮箱与密码，再发码 */}
            <div className="auth-field">
                <div className="auth-field-head">
                    <span className="auth-label" id="register-code-label">邮箱验证码</span>
                    <button
                        type="button"
                        onClick={onSendCode}
                        disabled={sendingCode || countdown > 0}
                        className="auth-link"
                        aria-describedby="register-code-label"
                    >
                        {sendingCode ? <SoundWaveLoader variant="inline" /> : countdown > 0 ? `${countdown} 秒后重新发送` : '发送验证码'}
                    </button>
                </div>
                <VerificationCodeInput
                    value={verificationCode}
                    onChange={onVerificationCodeChange}
                    length={6}
                    disabled={sendingCode}
                />
            </div>
        </>
    );
}
