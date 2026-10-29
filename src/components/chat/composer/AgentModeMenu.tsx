/**
 * Agent 运行模式：默认 / 计划 / 代码，同一时刻只有一种。
 *
 * 显示为一个按钮（当前模式 + 下拉箭头），点开与「+」同样式的弹窗选择，
 * 不在 chin 行并排铺三个分段控件。放在 chin 行左端，原「+」的位置。
 *
 * 'use client' 标记说明：
 * - 弹窗需要开关状态与焦点管理
 */
'use client';

import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { FloatingPanel } from '@/components/ui/FloatingPanel';

export type AgentRunMode = 'default' | 'plan' | 'code';

const MODES: ReadonlyArray<{ id: AgentRunMode; label: string; description: string }> = [
    { id: 'default', label: '默认', description: '直接执行任务' },
    { id: 'plan', label: '计划', description: '先提交分析计划，经你批准后再执行；下个任务生效' },
    { id: 'code', label: '代码', description: '允许 Agent 写脚本批量排盘、逐年扫描与比较参数；下个任务生效' },
];

export function AgentModeMenu({ planMode, codeMode, disabled, onPlanModeChange, onCodeModeChange }: {
    planMode: boolean;
    codeMode: boolean;
    disabled?: boolean;
    onPlanModeChange: (value: boolean) => void;
    onCodeModeChange: (value: boolean) => void;
}) {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const current = MODES.find(mode => mode.id === (codeMode ? 'code' : planMode ? 'plan' : 'default'))!;
    const select = (mode: AgentRunMode) => {
        onPlanModeChange(mode === 'plan');
        onCodeModeChange(mode === 'code');
        setOpen(false);
    };
    return <>
        <button ref={anchorRef} type="button" className="chat-tool-text chat-run-mode-trigger"
            aria-label={`运行模式：${current.label}`} aria-haspopup="menu" aria-expanded={open}
            disabled={disabled} onClick={() => setOpen(value => !value)}>
            <span>{current.label}</span><ChevronDown size={12} aria-hidden="true" />
        </button>
        <FloatingPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} label="运行模式"
            side="top" align="start" className="chat-plus-menu chat-run-mode-menu" arrowNavigation>
            {MODES.map(mode => <button key={mode.id} type="button" role="menuitemradio" aria-checked={current.id === mode.id}
                title={mode.description} onClick={() => select(mode.id)}>
                <span className="chat-plus-label">{mode.label}</span>{current.id === mode.id && <Check size={14} aria-hidden="true" />}
            </button>)}
        </FloatingPanel>
    </>;
}
