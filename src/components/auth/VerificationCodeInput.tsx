/**
 * 验证码输入组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useRef, useEffect)
 * - 有键盘导航和粘贴交互功能
 *
 * 填满后只自动提交一次：onComplete 每次渲染都是新函数，必须记住「这个完整的值已经提交过」，
 * 否则验证失败后的任何重渲染都会把同一个错码再提交一遍，直到被限流。
 * 用户改动任意一位（值长度回落）后才会再次触发。
 */
'use client';

import { useEffect, useRef, type CSSProperties, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/Input';
import { nextCompletedCode } from '@/lib/auth/otp-completion';
import './auth.css';

interface VerificationCodeInputProps {
    value: string;
    onChange: (value: string) => void;
    onComplete?: (value: string) => void;
    length?: number;
    disabled?: boolean;
    /** 验证失败时轻摇格子。 */
    invalid?: boolean;
    /** 挂载后聚焦第一格（模式切换时由弹层重新挂载）。 */
    autoFocus?: boolean;
}

export function VerificationCodeInput({
    value,
    onChange,
    onComplete,
    length = 6,
    disabled = false,
    invalid = false,
    autoFocus = false,
}: VerificationCodeInputProps) {
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const completedRef = useRef<string | null>(null);

    // 当值填满时自动触发一次完成回调；同一个完整值只提交一次（见 nextCompletedCode）。
    useEffect(() => {
        if (value.length < length) {
            completedRef.current = null;
            return;
        }
        const next = nextCompletedCode(completedRef.current, value, length);
        if (!next || !onComplete) return;
        completedRef.current = next;
        onComplete(next);
    }, [value, length, onComplete]);

    useEffect(() => {
        if (autoFocus) inputRefs.current[0]?.focus();
    }, [autoFocus]);

    const handleChange = (index: number, char: string) => {
        // 只允许数字
        const digit = char.replace(/\D/g, '').slice(-1);
        if (!digit && char !== '') return;

        const chars = Array.from({ length }, (_, slot) => value[slot] ?? '');
        chars[index] = digit;
        onChange(chars.join(''));

        // 自动跳转到下一个输入框
        if (digit && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
            if (!value[index] && index > 0) {
                // 当前格为空，删除上一格并聚焦
                const chars = Array.from({ length }, (_, slot) => value[slot] ?? '');
                chars[index - 1] = '';
                onChange(chars.join(''));
                inputRefs.current[index - 1]?.focus();
            } else {
                // 删除当前格
                const chars = Array.from({ length }, (_, slot) => value[slot] ?? '');
                chars[index] = '';
                onChange(chars.join(''));
            }
            e.preventDefault();
        } else if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus();
        } else if (e.key === 'ArrowRight' && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
        if (pastedData) {
            onChange(pastedData);
            // 聚焦到最后一个填入的位置或最后一格
            const focusIndex = Math.min(pastedData.length, length - 1);
            inputRefs.current[focusIndex]?.focus();
        }
    };

    const handleFocus = (index: number) => {
        // 聚焦时选中内容
        inputRefs.current[index]?.select();
    };

    return (
        <div
            className="auth-otp"
            data-invalid={invalid || undefined}
            style={{ '--otp-length': length } as CSSProperties}
            role="group"
            aria-label="验证码"
        >
            <div className="auth-otp-cells">
                {Array.from({ length }).map((_, index) => (
                    <Input
                        key={index}
                        ref={(el) => { inputRefs.current[index] = el; }}
                        type="text"
                        inputMode="numeric"
                        autoComplete={index === 0 ? 'one-time-code' : 'off'}
                        aria-label={`验证码第 ${index + 1} 位`}
                        maxLength={1}
                        value={value[index] || ''}
                        data-filled={value[index] ? '' : undefined}
                        onChange={(e) => handleChange(index, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(index, e)}
                        onPaste={handlePaste}
                        onFocus={() => handleFocus(index)}
                        disabled={disabled}
                    />
                ))}
            </div>
        </div>
    );
}
