/**
 * 认证弹窗组件
 * 
 * 支持登录、注册、忘记密码切换
 * Phase 3 增强：OTP验证码登录/注册、密码强度验证、登录限制
 */
'use client';

import { useReducer, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X, Lock, ArrowLeft, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import {
    signInWithEmail,
    signUpWithEmail,
    sendOTP,
    verifyOTP,
    recordLoginAttempt,
    resetPasswordWithOTP,
} from '@/lib/auth';
import { PasswordStrengthIndicator, validatePasswordStrength } from '@/components/auth/PasswordStrengthIndicator';
import { VerificationCodeInput } from '@/components/auth/VerificationCodeInput';
import { EmailField, LoginForm, resolveAuthEmail } from '@/components/auth/LoginForm';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { OAuthButtons } from '@/components/auth/OAuthButtons';

type AuthMode = 'login' | 'register' | 'forgot' | 'verify-login' | 'verify-reset' | 'reset-password';
type LoginMethod = 'password' | 'otp';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

// --- useReducer state & actions ---
interface AuthState {
    mode: AuthMode;
    loginMethod: LoginMethod;
    emailPrefix: string;
    emailSuffix: string;
    password: string;
    confirmPassword: string;
    showPassword: boolean;
    showConfirmPassword: boolean;
    nickname: string;
    verificationCode: string;
    loading: boolean;
    sendingCode: boolean;
    error: string;
    success: string;
    countdown: number;
}

type AuthAction =
    | { type: 'SET_FIELD'; field: keyof AuthState; value: AuthState[keyof AuthState] }
    | { type: 'RESET_FORM' }
    | { type: 'SWITCH_MODE'; mode: AuthMode }
    | { type: 'TICK_COUNTDOWN' };

const initialAuthState: AuthState = {
    mode: 'login',
    loginMethod: 'password',
    emailPrefix: '',
    emailSuffix: '@qq.com',
    password: '',
    confirmPassword: '',
    showPassword: false,
    showConfirmPassword: false,
    nickname: '',
    verificationCode: '',
    loading: false,
    sendingCode: false,
    error: '',
    success: '',
    countdown: 0,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
    switch (action.type) {
        case 'SET_FIELD':
            return { ...state, [action.field]: action.value };
        case 'RESET_FORM':
            return {
                ...state,
                emailPrefix: '',
                password: '',
                confirmPassword: '',
                showPassword: false,
                showConfirmPassword: false,
                nickname: '',
                verificationCode: '',
                error: '',
                success: '',
                countdown: 0,
            };
        case 'SWITCH_MODE': {
            const reset: Partial<AuthState> = {
                emailPrefix: '',
                password: '',
                confirmPassword: '',
                showPassword: false,
                showConfirmPassword: false,
                nickname: '',
                verificationCode: '',
                error: '',
                success: '',
                countdown: 0,
                mode: action.mode,
            };
            if (action.mode === 'login') {
                reset.loginMethod = 'password';
            }
            return { ...state, ...reset };
        }
        case 'TICK_COUNTDOWN':
            return { ...state, countdown: Math.max(0, state.countdown - 1) };
        default:
            return state;
    }
}

const EMAIL_SUFFIXES = [
    '@qq.com',
    '@163.com',
    '@126.com',
    '@gmail.com',
    '@outlook.com',
    '@icloud.com',
    '@foxmail.com',
];

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
    const router = useRouter();
    const [state, dispatch] = useReducer(authReducer, initialAuthState);
    const verifyingRef = useRef(false);

    const {
        mode, loginMethod, emailPrefix, emailSuffix,
        password, confirmPassword, showPassword, showConfirmPassword,
        nickname, verificationCode, loading, sendingCode,
        error, success, countdown,
    } = state;

    const setField = useCallback(<K extends keyof AuthState>(field: K, value: AuthState[K]) => {
        dispatch({ type: 'SET_FIELD', field, value });
    }, []);

    const email = resolveAuthEmail(emailPrefix, emailSuffix);

    // 倒计时效果
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => dispatch({ type: 'TICK_COUNTDOWN' }), 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown]);

    const switchMode = useCallback((newMode: AuthMode) => {
        dispatch({ type: 'SWITCH_MODE', mode: newMode });
    }, []);

    if (!isOpen) return null;

    // 认证成功后的统一处理
    const completeAuth = () => {
        onSuccess?.();
        onClose();
        router.refresh();
    };

    // 发送登录验证码
    const handleSendOTP = async () => {
        if (!emailPrefix) {
            setField('error', '请输入邮箱地址');
            return;
        }

        setField('error', '');
        setField('loading', true);

        try {
            const result = await sendOTP(email, 'magiclink');
            if (result.success) {
                setField('countdown', 60);
                setField('mode', 'verify-login');
                setField('success', '登录验证码已发送到您的邮箱');
            } else {
                setField('error', result.error?.message || '发送失败');
            }
        } catch {
            setField('error', '发送失败，请重试');
        } finally {
            setField('loading', false);
        }
    };

    // 注册时发送验证码（不切换模式）
    const handleSendRegisterCode = async () => {
        if (!emailPrefix) {
            setField('error', '请输入邮箱地址');
            return;
        }

        const { isValid } = validatePasswordStrength(password);
        if (!isValid) {
            setField('error', '请先设置符合要求的密码');
            return;
        }

        if (password !== confirmPassword) {
            setField('error', '两次输入的密码不一致');
            return;
        }

        setField('error', '');
        setField('sendingCode', true);

        try {
            let result = await signUpWithEmail(email, password, nickname);
            if (!result.success && result.error?.code === 'USER_ALREADY_EXISTS') {
                // 未验证的旧账号：重发验证码，验证后即可登录。
                result = await sendOTP(email, 'signup');
            }
            if (result.success) {
                setField('countdown', 60);
                setField('success', '验证码已发送到您的邮箱');
            } else {
                setField('error', result.error?.message || '发送失败');
            }
        } catch {
            setField('error', '发送失败，请重试');
        } finally {
            setField('sendingCode', false);
        }
    };

    // 重新发送验证码
    const handleResendOTP = async () => {
        if (countdown > 0) return;

        if (mode === 'verify-reset') {
            setField('error', '');
            setField('loading', true);
            try {
                const result = await sendOTP(email, 'recovery');
                if (result.success) {
                    setField('countdown', 60);
                    setField('success', '验证码已发送到您的邮箱');
                } else {
                    setField('error', result.error?.message || '发送失败');
                }
            } catch {
                setField('error', '发送失败，请重试');
            } finally {
                setField('loading', false);
            }
            return;
        }

        await handleSendOTP();
    };

    // 验证验证码
    const handleVerifyOTP = async (code?: string) => {
        if (verifyingRef.current) return;
        const codeToVerify = code || verificationCode;
        if (!codeToVerify || codeToVerify.length !== 6) {
            setField('error', '请输入6位验证码');
            return;
        }

        if (mode === 'verify-reset') {
            setField('error', '');
            setField('verificationCode', codeToVerify);
            setField('mode', 'reset-password');
            setField('success', '验证成功！请设置新密码');
            return;
        }

        setField('error', '');
        setField('loading', true);
        verifyingRef.current = true;

        try {
            const result = await verifyOTP(email, codeToVerify, 'magiclink');
            if (result.success) {
                completeAuth();
            } else {
                setField('error', result.error?.message || '验证失败');
            }
        } catch {
            setField('error', '验证失败，请重试');
        } finally {
            setField('loading', false);
            verifyingRef.current = false;
        }
    };

    // --- 拆分后的独立提交处理函数 ---

    const handleLogin = async () => {
        if (loginMethod === 'password') {
            const result = await signInWithEmail(email, password);
            if (result.success) {
                completeAuth();
            } else if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
                // 未验证邮箱：先发登录验证码，验证后即完成登录。
                await handleSendOTP();
            } else {
                setField('error', result.error?.message || '登录失败');
            }
        } else {
            await handleSendOTP();
        }
    };

    const handleRegister = async () => {
        if (!verificationCode || verificationCode.length !== 6) {
            setField('error', '请输入6位验证码');
            setField('loading', false);
            return;
        }

        const { isValid } = validatePasswordStrength(password);
        if (!isValid) {
            setField('error', '密码不符合强度要求');
            setField('loading', false);
            return;
        }

        if (password !== confirmPassword) {
            setField('error', '两次输入的密码不一致');
            setField('loading', false);
            return;
        }

        // 账号已在“发送验证码”时创建；此处只消费验证码并自动登录。
        const verifyResult = await verifyOTP(email, verificationCode, 'signup');
        if (verifyResult.success) {
            await recordLoginAttempt(email, true);
            setField('success', '注册成功！');
            completeAuth();
        } else {
            setField('error', verifyResult.error?.message || '验证码验证失败');
        }
    };

    const handleForgotPassword = async () => {
        setField('error', '');
        const result = await sendOTP(email, 'recovery');
        if (result.success) {
            setField('countdown', 60);
            setField('mode', 'verify-reset');
            setField('success', '验证码已发送到您的邮箱');
        } else {
            setField('error', result.error?.message || '发送失败');
        }
    };

    const handleResetPassword = async () => {
        const { isValid } = validatePasswordStrength(password);
        if (!isValid) {
            setField('error', '密码不符合强度要求');
            setField('loading', false);
            return;
        }

        if (password !== confirmPassword) {
            setField('error', '两次输入的密码不一致');
            setField('loading', false);
            return;
        }

        if (!verificationCode || verificationCode.length !== 6) {
            setField('error', '请输入6位验证码');
            setField('loading', false);
            return;
        }

        const resetResult = await resetPasswordWithOTP(email, verificationCode, password);
        if (!resetResult.success) {
            setField('error', resetResult.error?.message || '验证码已过期或无效');
            setField('loading', false);
            return;
        }

        setField('success', '密码重置成功！请使用新密码登录');
        dispatch({ type: 'SWITCH_MODE', mode: 'login' });
    };

    // 提交处理 - 路由到对应的独立处理函数
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setField('error', '');
        setField('success', '');
        setField('loading', true);

        try {
            switch (mode) {
                case 'login': await handleLogin(); break;
                case 'register': await handleRegister(); break;
                case 'forgot': await handleForgotPassword(); break;
                case 'reset-password': await handleResetPassword(); break;
                case 'verify-login':
                case 'verify-reset':
                    await handleVerifyOTP(); break;
            }
        } catch {
            setField('error', '操作失败，请重试');
        } finally {
            setField('loading', false);
        }
    };

    // 获取标题
    const getTitle = () => {
        switch (mode) {
            case 'login': return '登录';
            case 'register': return '注册';
            case 'forgot': return '重置密码';
            case 'verify-login': return '验证登录';
            case 'verify-reset': return '验证身份';
            case 'reset-password': return '设置新密码';
        }
    };

    // 获取提交按钮文字
    const getSubmitText = () => {
        switch (mode) {
            case 'login': return loginMethod === 'password' ? '登录' : '发送验证码';
            case 'register': return '注册';
            case 'forgot': return '发送验证码';
            case 'verify-login':
            case 'verify-reset': return '验证';
            case 'reset-password': return '重置密码';
        }
    };

    // 是否显示返回按钮
    const showBackButton = mode === 'forgot' || mode === 'verify-login' || mode === 'verify-reset' || mode === 'reset-password';

    // 返回上一步
    const handleBack = () => {
        if (mode === 'verify-login') {
            switchMode('login');
        } else if (mode === 'verify-reset' || mode === 'reset-password' || mode === 'forgot') {
            switchMode('login');
        } else {
            switchMode('login');
        }
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center" role="dialog" aria-modal="true">
            {/* 背景遮罩 */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* 弹窗内容 */}
            <div className="relative w-full max-w-md mx-4 bg-background rounded-2xl border border-border shadow-2xl animate-fade-in">
                {/* 头部 */}
                <div className="flex items-center justify-between p-6 border-b border-border">
                    <div className="flex items-center gap-2">
                        {showBackButton && (
                            <button
                                onClick={handleBack}
                                className="p-1 rounded-lg hover:bg-background-secondary transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        )}
                        <h2 className="text-xl font-bold">{getTitle()}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-background-secondary transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* 表单 */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {/* 错误/成功提示 */}
                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="p-3 rounded-lg bg-green-500/10 text-green-500 text-sm">
                            {success}
                        </div>
                    )}

                    {/* 登录模式 */}
                    {mode === 'login' && (
                        <LoginForm
                            loginMethod={loginMethod}
                            onLoginMethodChange={(v) => setField('loginMethod', v)}
                            emailPrefix={emailPrefix}
                            onEmailPrefixChange={(v) => setField('emailPrefix', v)}
                            emailSuffix={emailSuffix}
                            onEmailSuffixChange={(v) => setField('emailSuffix', v)}
                            emailSuffixes={EMAIL_SUFFIXES}
                            password={password}
                            onPasswordChange={(v) => setField('password', v)}
                            showPassword={showPassword}
                            onToggleShowPassword={() => setField('showPassword', !showPassword)}
                            onForgotPassword={() => switchMode('forgot')}
                        />
                    )}

                    {/* 验证码输入（验证模式） */}
                    {(mode === 'verify-login' || mode === 'verify-reset') && (
                        <div className="space-y-4">
                            <p className="text-sm text-foreground-secondary text-center">
                                验证码已发送至 <span className="font-medium text-foreground">{email}</span>
                            </p>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground-secondary text-center block">
                                    验证码
                                </label>
                                <VerificationCodeInput
                                    value={verificationCode}
                                    onChange={(v) => setField('verificationCode', v)}
                                    onComplete={handleVerifyOTP}
                                    length={6}
                                    disabled={loading}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleResendOTP}
                                disabled={countdown > 0}
                                className="flex items-center justify-center gap-2 w-full py-2 text-sm text-foreground-secondary hover:text-foreground disabled:opacity-50 transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                {countdown > 0 ? `${countdown}秒后可重新发送` : '重新发送验证码'}
                            </button>
                        </div>
                    )}

                    {/* 设置密码模式 */}
                    {mode === 'reset-password' && (
                        <>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground-secondary">
                                    新密码
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-secondary" />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setField('password', e.target.value)}
                                        placeholder="设置新密码"
                                        required
                                        minLength={8}
                                        className="w-full pl-10 pr-10 py-3 rounded-xl bg-background-secondary border border-border focus:border-accent focus:outline-none transition-colors"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setField('showPassword', !showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-secondary hover:text-foreground transition-colors"
                                    >
                                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                                <PasswordStrengthIndicator password={password} />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground-secondary">
                                    确认新密码
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-secondary" />
                                    <input
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        value={confirmPassword}
                                        onChange={(e) => setField('confirmPassword', e.target.value)}
                                        placeholder="再次输入新密码"
                                        required
                                        minLength={8}
                                        className={`w-full pl-10 pr-10 py-3 rounded-xl bg-background-secondary border focus:outline-none transition-colors ${confirmPassword && password !== confirmPassword
                                            ? 'border-red-500 focus:border-red-500'
                                            : 'border-border focus:border-accent'
                                            }`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setField('showConfirmPassword', !showConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-secondary hover:text-foreground transition-colors"
                                    >
                                        {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                                {confirmPassword && password !== confirmPassword && (
                                    <p className="text-xs text-red-500">两次输入的密码不一致</p>
                                )}
                            </div>
                        </>
                    )}

                    {/* 注册模式 */}
                    {mode === 'register' && (
                        <RegisterForm
                            nickname={nickname}
                            onNicknameChange={(v) => setField('nickname', v)}
                            emailPrefix={emailPrefix}
                            onEmailPrefixChange={(v) => setField('emailPrefix', v)}
                            emailSuffix={emailSuffix}
                            onEmailSuffixChange={(v) => setField('emailSuffix', v)}
                            emailSuffixes={EMAIL_SUFFIXES}
                            password={password}
                            onPasswordChange={(v) => setField('password', v)}
                            confirmPassword={confirmPassword}
                            onConfirmPasswordChange={(v) => setField('confirmPassword', v)}
                            showPassword={showPassword}
                            onToggleShowPassword={() => setField('showPassword', !showPassword)}
                            showConfirmPassword={showConfirmPassword}
                            onToggleShowConfirmPassword={() => setField('showConfirmPassword', !showConfirmPassword)}
                            verificationCode={verificationCode}
                            onVerificationCodeChange={(v) => setField('verificationCode', v)}
                            onSendCode={handleSendRegisterCode}
                            sendingCode={sendingCode}
                            countdown={countdown}
                            loading={loading}
                        />
                    )}

                    {/* 忘记密码模式 - 邮箱输入 */}
                    {mode === 'forgot' && (
                        <EmailField
                            emailPrefix={emailPrefix}
                            onEmailPrefixChange={(v) => setField('emailPrefix', v)}
                            emailSuffix={emailSuffix}
                            onEmailSuffixChange={(v) => setField('emailSuffix', v)}
                            emailSuffixes={EMAIL_SUFFIXES}
                        />
                    )}

                    {/* 提交按钮 */}
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-xl bg-accent text-on-accent font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading && <SoundWaveLoader variant="inline" />}
                        {getSubmitText()}
                    </button>

                    {/* 第三方登录 */}
                    {(mode === 'login' || mode === 'register') && (
                        <OAuthButtons />
                    )}

                    {/* 切换登录/注册 */}
                    {(mode === 'login' || mode === 'register') && (
                        <div className="text-center text-sm text-foreground-secondary">
                            {mode === 'login' ? (
                                <>
                                    还没有账号？
                                    <button
                                        type="button"
                                        onClick={() => switchMode('register')}
                                        className="text-accent hover:underline ml-1"
                                    >
                                        立即注册
                                    </button>
                                </>
                            ) : (
                                <>
                                    已有账号？
                                    <button
                                        type="button"
                                        onClick={() => switchMode('login')}
                                        className="text-accent hover:underline ml-1"
                                    >
                                        立即登录
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* 法律声明 */}
                    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-foreground-secondary pt-2">
                        <span>登录即表示同意</span>
                        <Link
                            href="/terms"
                            target="_blank"
                            className="text-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                        >
                            《服务条款》
                        </Link>
                        <span>和</span>
                        <Link
                            href="/privacy"
                            target="_blank"
                            className="text-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                        >
                            《隐私政策》
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
