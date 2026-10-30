/**
 * 认证弹窗组件
 *
 * 支持登录、注册、忘记密码切换
 * Phase 3 增强：OTP验证码登录/注册、密码强度验证、登录限制
 *
 * 宽屏是左右两栏：左栏是徽记与经文，右栏是表单；手机是从底部升起的面板。
 * 弹层本身用共享的 Modal（原生 dialog、焦点圈定、退场动画），不再手写遮罩。
 */
'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CircleAlert, CircleCheck, RefreshCw, X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import {
    signInWithEmail,
    signUpWithEmail,
    sendOTP,
    verifyOTP,
    resetPasswordWithOTP,
} from '@/lib/auth';
import { PasswordStrengthIndicator, validatePasswordStrength } from '@/components/auth/PasswordStrengthIndicator';
import { VerificationCodeInput } from '@/components/auth/VerificationCodeInput';
import { EmailField, LoginForm, PasswordField } from '@/components/auth/LoginForm';
import { normalizeAuthEmail } from '@/lib/auth/email';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { AuthEmblem } from '@/components/auth/AuthEmblem';
import { BrandMark } from '@/components/brand/BrandMark';
import '@/components/auth/auth.css';

type AuthMode = 'login' | 'register' | 'forgot' | 'verify-login' | 'verify-reset' | 'reset-password';
type LoginMethod = 'password' | 'otp';
/** Why the six-digit code in verify-login was sent. */
type VerifyPurpose = 'login' | 'verify-email';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

// --- useReducer state & actions ---
interface AuthState {
    mode: AuthMode;
    loginMethod: LoginMethod;
    email: string;
    password: string;
    confirmPassword: string;
    showPassword: boolean;
    showConfirmPassword: boolean;
    nickname: string;
    verificationCode: string;
    verifyPurpose: VerifyPurpose;
    loading: boolean;
    sendingCode: boolean;
    error: string;
    success: string;
    countdown: number;
}

type AuthAction =
    | { type: 'SET_FIELD'; field: keyof AuthState; value: AuthState[keyof AuthState] }
    | { type: 'SWITCH_MODE'; mode: AuthMode }
    | { type: 'TICK_COUNTDOWN' };

const initialAuthState: AuthState = {
    mode: 'login',
    loginMethod: 'password',
    email: '',
    password: '',
    confirmPassword: '',
    showPassword: false,
    showConfirmPassword: false,
    nickname: '',
    verificationCode: '',
    verifyPurpose: 'login',
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
        case 'SWITCH_MODE': {
            // 邮箱在模式之间保留：验证码页返回登录、登录与注册互切时不必重填。
            const reset: Partial<AuthState> = {
                password: '',
                confirmPassword: '',
                showPassword: false,
                showConfirmPassword: false,
                nickname: '',
                verificationCode: '',
                verifyPurpose: 'login',
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

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
    const router = useRouter();
    const [state, dispatch] = useReducer(authReducer, initialAuthState);
    const verifyingRef = useRef(false);
    const emailRef = useRef<HTMLInputElement | null>(null);
    const passwordRef = useRef<HTMLInputElement | null>(null);

    const {
        mode, loginMethod, email,
        password, confirmPassword, showPassword, showConfirmPassword,
        nickname, verificationCode, verifyPurpose, loading, sendingCode,
        error, success, countdown,
    } = state;

    const setField = useCallback(<K extends keyof AuthState>(field: K, value: AuthState[K]) => {
        dispatch({ type: 'SET_FIELD', field, value });
    }, []);

    const normalizedEmail = normalizeAuthEmail(email);

    // 倒计时效果
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => dispatch({ type: 'TICK_COUNTDOWN' }), 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown]);

    // 打开或换页后把焦点放到当前页的第一个输入框；验证码页由输入组件自己聚焦第一格。
    // 切换登录方式不算换页：焦点留在刚点的标签上，键盘用户不会被拽走。
    useEffect(() => {
        if (!isOpen) return;
        const frame = requestAnimationFrame(() => {
            const target = mode === 'reset-password' ? passwordRef.current : emailRef.current;
            target?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [isOpen, mode]);

    const switchMode = useCallback((newMode: AuthMode) => {
        dispatch({ type: 'SWITCH_MODE', mode: newMode });
    }, []);

    // 认证成功后的统一处理
    const completeAuth = () => {
        onSuccess?.();
        onClose();
        router.refresh();
    };

    // 发送登录验证码
    const handleSendOTP = async () => {
        if (!normalizedEmail) {
            setField('error', '请输入邮箱地址');
            return;
        }

        setField('error', '');
        setField('loading', true);

        try {
            const result = await sendOTP(normalizedEmail, 'magiclink');
            if (result.success) {
                setField('countdown', 60);
                setField('mode', 'verify-login');
                setField('verifyPurpose', 'login');
                setField('success', '登录验证码已发送到你的邮箱');
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
        if (!normalizedEmail) {
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
            // For an address that already exists Better Auth answers generically
            // and mails the owner a notice; the form cannot tell the two apart.
            const result = await signUpWithEmail(normalizedEmail, password, nickname);
            if (result.success) {
                setField('countdown', 60);
                setField('success', '验证码已发送；若该邮箱已注册，请直接登录或使用验证码登录');
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
                const result = await sendOTP(normalizedEmail, 'recovery');
                if (result.success) {
                    setField('countdown', 60);
                    setField('success', '验证码已发送到你的邮箱');
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

        if (mode === 'verify-login' && verifyPurpose === 'verify-email') {
            setField('error', '');
            setField('loading', true);
            try {
                const result = await sendOTP(normalizedEmail, 'signup');
                if (result.success) {
                    setField('countdown', 60);
                    setField('success', '验证码已发送到你的邮箱');
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
            setField('error', '请输入 6 位验证码');
            return;
        }

        if (mode === 'verify-reset') {
            setField('error', '');
            setField('verificationCode', codeToVerify);
            setField('mode', 'reset-password');
            setField('success', '验证成功，请设置新密码');
            return;
        }

        setField('error', '');
        setField('loading', true);
        verifyingRef.current = true;

        try {
            if (verifyPurpose === 'verify-email') {
                const verified = await verifyOTP(normalizedEmail, codeToVerify, 'signup');
                if (!verified.success) {
                    setField('error', verified.error?.message || '验证失败');
                    return;
                }
                // The address is verified now; the password was already checked.
                const login = await signInWithEmail(normalizedEmail, password);
                if (login.success) {
                    completeAuth();
                    return;
                }
                switchMode('login');
                setField('error', '邮箱已验证，请使用密码登录');
                return;
            }
            const result = await verifyOTP(normalizedEmail, codeToVerify, 'magiclink');
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
            const result = await signInWithEmail(normalizedEmail, password);
            if (result.success) {
                completeAuth();
            } else if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
                // Do not send a sign-in code: Better Auth revokes every account
                // (including this proven password) when an email OTP promotes an
                // unverified user. An email-verification code keeps the password.
                const sent = await sendOTP(normalizedEmail, 'signup');
                if (sent.success) {
                    setField('verifyPurpose', 'verify-email');
                    setField('countdown', 60);
                    setField('mode', 'verify-login');
                    setField('success', '邮箱尚未验证，验证码已发送；验证后会用刚才的密码登录');
                } else {
                    setField('error', sent.error?.message || '发送失败');
                }
            } else {
                setField('error', result.error?.message || '登录失败');
            }
        } else {
            await handleSendOTP();
        }
    };

    const handleRegister = async () => {
        if (!verificationCode || verificationCode.length !== 6) {
            setField('error', '请输入 6 位验证码');
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
        const verifyResult = await verifyOTP(normalizedEmail, verificationCode, 'signup');
        if (verifyResult.success) {
            setField('success', '注册成功');
            completeAuth();
        } else {
            setField('error', verifyResult.error?.message || '验证码验证失败');
        }
    };

    const handleForgotPassword = async () => {
        setField('error', '');
        const result = await sendOTP(normalizedEmail, 'recovery');
        if (result.success) {
            setField('countdown', 60);
            setField('mode', 'verify-reset');
            setField('success', '验证码已发送到你的邮箱');
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
            setField('error', '请输入 6 位验证码');
            setField('loading', false);
            return;
        }

        const resetResult = await resetPasswordWithOTP(normalizedEmail, verificationCode, password);
        if (!resetResult.success) {
            setField('error', resetResult.error?.message || '验证码已过期或无效');
            setField('loading', false);
            return;
        }

        // 换页会清掉提示，这里先切回登录再补一条，邮箱保持不变。
        const keptEmail = email;
        dispatch({ type: 'SWITCH_MODE', mode: 'login' });
        setField('email', keptEmail);
        setField('success', '密码已重置，请用新密码登录');
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

    const title = (() => {
        switch (mode) {
            case 'login': return '登录';
            case 'register': return '创建账号';
            case 'forgot': return '找回密码';
            case 'verify-login': return verifyPurpose === 'verify-email' ? '验证邮箱' : '输入登录验证码';
            case 'verify-reset': return '验证身份';
            case 'reset-password': return '设置新密码';
        }
    })();

    const subtitle = (() => {
        switch (mode) {
            case 'login': return '登录后继续你的排盘、对话与记录。';
            case 'register': return '一个邮箱就是全部，注册后即可开始。';
            case 'forgot': return '输入注册邮箱，我们会发送 6 位验证码。';
            case 'verify-login':
            case 'verify-reset': return <>验证码已发送至 <strong>{normalizedEmail}</strong></>;
            case 'reset-password': return '验证已通过，设置一个新密码。';
        }
    })();

    const submitText = (() => {
        switch (mode) {
            case 'login': return loginMethod === 'password' ? '登录' : '发送验证码';
            case 'register': return '注册';
            case 'forgot': return '发送验证码';
            case 'verify-login':
            case 'verify-reset': return '验证';
            case 'reset-password': return '重置密码';
        }
    })();

    const showBackButton = mode !== 'login' && mode !== 'register';
    const isVerifyMode = mode === 'verify-login' || mode === 'verify-reset';

    const handleBack = () => switchMode('login');

    return (
        <Dialog bare
            open={isOpen}
            onClose={onClose}
            labelledBy="auth-title"
            className="auth-dialog"
            initialFocusRef={emailRef}
        >
            <span className="auth-grabber" aria-hidden="true" />
            <div className="auth-shell">
                {/* 品牌栏：宽屏才显示 */}
                <aside className="auth-brand" aria-hidden="true">
                    <div className="auth-brand-logo"><BrandMark className="auth-brand-mark" />太卜</div>
                    <div className="auth-brand-hero">
                        <AuthEmblem size={236} />
                        <div className="auth-brand-quote">
                            <p>观天之道，执天之行</p>
                            <small>《阴符经》</small>
                        </div>
                    </div>
                    <div className="auth-brand-foot">八字 · 紫微 · 六爻 · 奇门 · 大六壬</div>
                </aside>

                <div className="auth-pane">
                    <div className="auth-actions">
                        {showBackButton && (
                            <Button unstyled type="button" className="auth-icon-button" aria-label="返回登录" onClick={handleBack}>
                                <ArrowLeft aria-hidden="true" />
                            </Button>
                        )}
                        <Button unstyled type="button" className="auth-icon-button" aria-label="关闭" onClick={onClose}>
                            <X aria-hidden="true" />
                        </Button>
                    </div>

                    <div className="auth-scroll">
                        <div className="auth-body" key={mode}>
                            <div className="auth-compact-brand"><BrandMark className="auth-compact-mark" />太卜</div>
                            <div className="auth-heading">
                                <h2 id="auth-title" className="auth-title">{title}</h2>
                                <p className="auth-subtitle">{subtitle}</p>
                            </div>

                            <form onSubmit={handleSubmit} className="auth-form">
                                {error && (
                                    <div className="auth-notice" data-tone="error" role="alert">
                                        <CircleAlert aria-hidden="true" />
                                        <span>{error}</span>
                                    </div>
                                )}
                                {success && (
                                    <div className="auth-notice" data-tone="success" role="status">
                                        <CircleCheck aria-hidden="true" />
                                        <span>{success}</span>
                                    </div>
                                )}

                                {mode === 'login' && (
                                    <LoginForm
                                        loginMethod={loginMethod}
                                        onLoginMethodChange={(value) => setField('loginMethod', value)}
                                        email={email}
                                        onEmailChange={(value) => setField('email', value)}
                                        password={password}
                                        onPasswordChange={(value) => setField('password', value)}
                                        showPassword={showPassword}
                                        onToggleShowPassword={() => setField('showPassword', !showPassword)}
                                        onForgotPassword={() => switchMode('forgot')}
                                        emailRef={emailRef}
                                        passwordRef={passwordRef}
                                    />
                                )}

                                {(mode === 'verify-login' || mode === 'verify-reset') && (
                                    <>
                                        <VerificationCodeInput
                                            value={verificationCode}
                                            onChange={(value) => {
                                                setField('verificationCode', value);
                                                // 用户开始改这一串时，上一次的错误提示与红框一起退场。
                                                if (error) setField('error', '');
                                            }}
                                            onComplete={(code) => { void handleVerifyOTP(code); }}
                                            length={6}
                                            disabled={loading}
                                            invalid={Boolean(error)}
                                            autoFocus
                                        />
                                        <Button unstyled
                                            type="button"
                                            onClick={handleResendOTP}
                                            disabled={countdown > 0 || loading}
                                            className="auth-resend"
                                        >
                                            <RefreshCw aria-hidden="true" />
                                            {countdown > 0 ? `${countdown} 秒后可重新发送` : '重新发送验证码'}
                                        </Button>
                                    </>
                                )}

                                {mode === 'reset-password' && (
                                    <>
                                        <PasswordField
                                            id="reset-password"
                                            label="新密码"
                                            value={password}
                                            onChange={(value) => setField('password', value)}
                                            show={showPassword}
                                            onToggleShow={() => setField('showPassword', !showPassword)}
                                            autoComplete="new-password"
                                            minLength={8}
                                            placeholder="设置新密码"
                                            inputRef={passwordRef}
                                            hint={<PasswordStrengthIndicator password={password} />}
                                        />
                                        <PasswordField
                                            id="reset-confirm-password"
                                            label="确认新密码"
                                            value={confirmPassword}
                                            onChange={(value) => setField('confirmPassword', value)}
                                            show={showConfirmPassword}
                                            onToggleShow={() => setField('showConfirmPassword', !showConfirmPassword)}
                                            autoComplete="new-password"
                                            minLength={8}
                                            placeholder="再次输入新密码"
                                            error={confirmPassword && password !== confirmPassword ? '两次输入的密码不一致' : undefined}
                                        />
                                        <p className="auth-hint">验证码已验证，提交后即可用新密码登录。</p>
                                    </>
                                )}

                                {mode === 'register' && (
                                    <RegisterForm
                                        nickname={nickname}
                                        onNicknameChange={(value) => setField('nickname', value)}
                                        email={email}
                                        onEmailChange={(value) => setField('email', value)}
                                        password={password}
                                        onPasswordChange={(value) => setField('password', value)}
                                        confirmPassword={confirmPassword}
                                        onConfirmPasswordChange={(value) => setField('confirmPassword', value)}
                                        showPassword={showPassword}
                                        onToggleShowPassword={() => setField('showPassword', !showPassword)}
                                        showConfirmPassword={showConfirmPassword}
                                        onToggleShowConfirmPassword={() => setField('showConfirmPassword', !showConfirmPassword)}
                                        verificationCode={verificationCode}
                                        onVerificationCodeChange={(value) => setField('verificationCode', value)}
                                        onSendCode={handleSendRegisterCode}
                                        sendingCode={sendingCode}
                                        countdown={countdown}
                                        emailRef={emailRef}
                                    />
                                )}

                                {mode === 'forgot' && (
                                    <EmailField
                                        email={email}
                                        onEmailChange={(value) => setField('email', value)}
                                        inputRef={emailRef}
                                    />
                                )}

                                <Button unstyled
                                    type="submit"
                                    disabled={loading}
                                    aria-busy={loading || undefined}
                                    className="auth-submit"
                                >
                                    {loading && <SoundWaveLoader variant="inline" />}
                                    {submitText}
                                </Button>

                                {(mode === 'login' || mode === 'register') && <OAuthButtons />}

                                {(mode === 'login' || mode === 'register') && (
                                    <p className="auth-switch">
                                        {mode === 'login' ? '还没有账号？' : '已有账号？'}
                                        <Button unstyled
                                            type="button"
                                            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                                        >
                                            {mode === 'login' ? '立即注册' : '立即登录'}
                                        </Button>
                                    </p>
                                )}

                                {isVerifyMode && (
                                    <p className="auth-switch">
                                        邮箱填错了？
                                        <Button unstyled type="button" onClick={handleBack}>返回重新填写</Button>
                                    </p>
                                )}
                            </form>

                            <p className="auth-legal">
                                继续即表示同意
                                <Link href="/terms" target="_blank">《服务条款》</Link>
                                和
                                <Link href="/privacy" target="_blank">《隐私政策》</Link>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </Dialog>
    );
}
