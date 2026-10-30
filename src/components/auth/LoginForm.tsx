/**
 * 登录表单字段组件
 *
 * 'use client' 标记说明：
 * - 使用交互状态控制密码可见性与邮箱提示
 * - 登录方式切换用滑动选中块（lib/motion/tab-indicator）
 */
'use client';

import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useTabIndicator } from '@/lib/motion/tab-indicator';
import { isCompleteEmail, normalizeAuthEmail } from '@/lib/auth/email';

type LoginMethod = 'password' | 'otp';

interface LoginFormProps {
    loginMethod: LoginMethod;
    onLoginMethodChange: (method: LoginMethod) => void;
    email: string;
    onEmailChange: (value: string) => void;
    password: string;
    onPasswordChange: (value: string) => void;
    showPassword: boolean;
    onToggleShowPassword: () => void;
    onForgotPassword: () => void;
    emailRef?: RefObject<HTMLInputElement | null>;
    passwordRef?: RefObject<HTMLInputElement | null>;
}

export function LoginForm({
    loginMethod,
    onLoginMethodChange,
    email,
    onEmailChange,
    password,
    onPasswordChange,
    showPassword,
    onToggleShowPassword,
    onForgotPassword,
    emailRef,
    passwordRef,
}: LoginFormProps) {
    const tabsRef = useRef<HTMLDivElement>(null);
    useTabIndicator(tabsRef);
    const selectMethod = (method: LoginMethod) => {
        if (method !== loginMethod) onLoginMethodChange(method);
    };

    return (
        <>
            {/* 登录方式：选中块随点击滑过去，键盘左右键也能切换 */}
            <div
                ref={tabsRef}
                role="tablist"
                aria-label="登录方式"
                className="auth-tabs motion-tabs motion-tabs--pill"
                onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const next: LoginMethod = loginMethod === 'password' ? 'otp' : 'password';
                    selectMethod(next);
                    tabsRef.current?.querySelector<HTMLElement>(`#auth-tab-${next}`)?.focus();
                }}
            >
                <Button unstyled
                    type="button"
                    role="tab"
                    id="auth-tab-password"
                    aria-selected={loginMethod === 'password'}
                    aria-controls="auth-method-panel"
                    tabIndex={loginMethod === 'password' ? 0 : -1}
                    onClick={() => selectMethod('password')}
                >
                    密码登录
                </Button>
                <Button unstyled
                    type="button"
                    role="tab"
                    id="auth-tab-otp"
                    aria-selected={loginMethod === 'otp'}
                    aria-controls="auth-method-panel"
                    tabIndex={loginMethod === 'otp' ? 0 : -1}
                    onClick={() => selectMethod('otp')}
                >
                    验证码登录
                </Button>
            </div>

            <div id="auth-method-panel" role="tabpanel" aria-labelledby={`auth-tab-${loginMethod}`} className="auth-fields">
                <EmailField email={email} onEmailChange={onEmailChange} inputRef={emailRef} />

                {/* 密码只在密码登录时可用；输入框始终占位，切换登录方式时弹窗高度不变，邮箱不会移动。 */}
                <div className="auth-password-slot" data-otp={loginMethod === 'otp' || undefined}>
                    <div className="auth-password-slot-fields" inert={loginMethod === 'otp'} aria-hidden={loginMethod === 'otp' || undefined}>
                        <PasswordField
                            id="auth-password"
                            label="密码"
                            value={password}
                            onChange={onPasswordChange}
                            show={showPassword}
                            onToggleShow={onToggleShowPassword}
                            autoComplete="current-password"
                            minLength={6}
                            placeholder="输入密码"
                            required={loginMethod === 'password'}
                            action={<Button unstyled type="button" onClick={onForgotPassword} className="auth-link">忘记密码？</Button>}
                            inputRef={passwordRef}
                        />
                    </div>
                    {loginMethod === 'otp' && (
                        <p className="auth-password-slot-note">验证码会发送到上面的邮箱，10 分钟内有效。</p>
                    )}
                </div>
            </div>
        </>
    );
}

/**
 * 邮箱输入字段：一个完整的邮箱地址，失焦后若还不像邮箱就给出例子。
 * 真正的把关仍交给 type="email" 的浏览器校验与认证服务。
 */
export function EmailField({
    email,
    onEmailChange,
    inputRef,
    label = '邮箱',
}: {
    email: string;
    onEmailChange: (value: string) => void;
    inputRef?: RefObject<HTMLInputElement | null>;
    label?: string;
}) {
    const id = useId();
    const [touched, setTouched] = useState(false);
    const incomplete = normalizeAuthEmail(email).length > 0 && !isCompleteEmail(email);
    const showError = touched && incomplete;
    return (
        <div className="auth-field">
            <div className="auth-field-head">
                <label htmlFor={id} className="auth-label">{label}</label>
            </div>
            <div className="auth-control" data-invalid={showError || undefined}>
                <Mail aria-hidden="true" />
                <Input
                    ref={inputRef}
                    id={id}
                    type="email"
                    value={email}
                    onChange={(e) => onEmailChange(e.target.value)}
                    onBlur={() => setTouched(true)}
                    placeholder="name@example.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="email"
                    required
                    aria-invalid={showError || undefined}
                    aria-describedby={showError ? `${id}-hint` : undefined}
                />
            </div>
            {showError && (
                <p className="auth-field-error" id={`${id}-hint`}>邮箱需要完整的地址，例如 name@example.com</p>
            )}
        </div>
    );
}

/** 共享密码字段：可见性开关带 aria-label 与 aria-pressed。 */
export function PasswordField({
    id,
    label,
    value,
    onChange,
    show,
    onToggleShow,
    autoComplete,
    minLength,
    placeholder,
    required = true,
    action,
    error,
    hint,
    inputRef,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    show: boolean;
    onToggleShow: () => void;
    autoComplete: 'current-password' | 'new-password';
    minLength: number;
    placeholder: string;
    required?: boolean;
    action?: ReactNode;
    error?: string;
    hint?: ReactNode;
    inputRef?: RefObject<HTMLInputElement | null>;
}) {
    return (
        <div className="auth-field">
            <div className="auth-field-head">
                <label htmlFor={id} className="auth-label">{label}</label>
                {action}
            </div>
            <div className="auth-control" data-invalid={error ? true : undefined}>
                <Lock aria-hidden="true" />
                <Input
                    ref={inputRef}
                    id={id}
                    type={show ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    required={required}
                    minLength={minLength}
                    aria-invalid={error ? true : undefined}
                />
                <Button unstyled
                    type="button"
                    className="auth-icon-button"
                    aria-label={show ? '隐藏密码' : '显示密码'}
                    aria-pressed={show}
                    onClick={onToggleShow}
                >
                    {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
            </div>
            {error && <p className="auth-field-error">{error}</p>}
            {hint}
        </div>
    );
}
