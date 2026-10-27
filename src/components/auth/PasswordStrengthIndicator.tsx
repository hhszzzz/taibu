/**
 * 密码强度指示器组件
 *
 * 四条要求（长度、小写、大写、数字）逐条点亮；强度条每格按进度展开，
 * 满足的要求用勾号描线出现，不满足时是一个灰点。
 */
'use client';

import { useMemo } from 'react';
import { Check } from 'lucide-react';
import './auth.css';

interface PasswordStrengthResult {
    isValid: boolean;
    score: number; // 0-4
    checks: {
        minLength: boolean;
        hasLowercase: boolean;
        hasUppercase: boolean;
        hasNumber: boolean;
    };
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
    const checks = {
        minLength: password.length >= 8,
        hasLowercase: /[a-z]/.test(password),
        hasUppercase: /[A-Z]/.test(password),
        hasNumber: /\d/.test(password),
    };

    const score = Object.values(checks).filter(Boolean).length;
    const isValid = checks.minLength && checks.hasLowercase && checks.hasUppercase && checks.hasNumber;

    return { isValid, score, checks };
}

const LABELS = ['弱', '弱', '中', '强', '极强'];
const REQUIREMENTS = [
    { key: 'minLength', label: '至少 8 个字符' },
    { key: 'hasLowercase', label: '含小写字母' },
    { key: 'hasUppercase', label: '含大写字母' },
    { key: 'hasNumber', label: '含数字' },
] as const;

interface PasswordStrengthIndicatorProps {
    password: string;
}

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
    const { score, checks } = useMemo(() => validatePasswordStrength(password), [password]);

    if (!password) return null;

    return (
        <div className="auth-strength" data-score={score} aria-live="polite">
            <div className="auth-strength-meter">
                <div className="auth-strength-bars" aria-hidden="true">
                    {[0, 1, 2, 3].map(index => (
                        <span key={index} data-on={index < score ? '' : undefined}><i /></span>
                    ))}
                </div>
                <span className="auth-strength-label">{LABELS[score]}</span>
            </div>
            <ul className="auth-strength-checks">
                {REQUIREMENTS.map((requirement) => {
                    const met = checks[requirement.key];
                    return (
                        <li key={requirement.key} data-met={met ? '' : undefined}>
                            {met && <Check aria-hidden="true" />}
                            {requirement.label}
                            <span className="sr-only">{met ? '已满足' : '未满足'}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
