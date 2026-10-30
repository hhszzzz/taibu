/**
 * 「对话方式」切换控件（Agent / 对话）：形态照 claude 标题栏的模式分段控件——
 * 70×28 轨道（r7、1px 内衬）+ 34×26 滑动白滑块 + 两个 16px 图标段（各带 Tooltip）。
 *
 * 数据来自 mode-control-store：桌面侧栏品牌行与移动抽屉各渲染一处，两者可视性互斥，
 * 全页始终只有一个单选组。
 *
 * 常驻范围（用户裁定 2026-10-17）：**全站侧栏常驻**。/chat 页面发布控件（页内切换即时生效）；
 * 其它页面用 `fallback`——读同一份本地偏好显示当前方式，点击落盘并导航回 /chat。
 *
 * 'use client' 标记说明：
 * - 需要键盘事件与 store 订阅
 */
'use client';

import { MessagesSquare } from 'lucide-react';
import { AgentIcon } from '@/lib/navigation/nav-icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/Button';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { setChatMode, useChatModeControl } from '@/lib/chat/mode-control-store';

export interface ModeSwitchFallback {
    mode: 'agent' | 'plain';
    agentDisabled?: boolean;
    plainDisabled?: boolean;
    onSelect: (mode: 'agent' | 'plain') => void;
}

const LABELS = { agent: 'Agent', plain: '对话' } as const;

export function ModeSwitch({ className = 'chat-mode-switch', fallback }: { className?: string; fallback?: ModeSwitchFallback }) {
    const control = useChatModeControl();
    const state = control ?? (fallback ? { mode: fallback.mode, agentDisabled: !!fallback.agentDisabled, plainDisabled: !!fallback.plainDisabled } : null);
    if (!state) return null;
    const select = (mode: 'agent' | 'plain') => {
        if (control) setChatMode(mode);
        else fallback?.onSelect(mode);
    };
    return (
        <div role="radiogroup" aria-label="对话方式" className={className}
            onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                const group = event.currentTarget;
                const next = state.mode === 'agent' ? 'plain' : 'agent';
                if (next === 'agent' ? state.agentDisabled : state.plainDisabled) return;
                select(next);
                requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
            }}>
            <Button unstyled type="button" role="radio" aria-checked={state.mode === 'plain'} aria-label={LABELS.plain}
                tabIndex={state.mode === 'plain' ? 0 : -1} disabled={state.plainDisabled && state.mode !== 'plain'} onClick={() => select('plain')}>
                <Tooltip label="对话" side="bottom"><span className="chat-mode-switch-icon"><MessagesSquare size={16} strokeWidth={1.8} aria-hidden="true" /></span></Tooltip>
            </Button>
            <Button unstyled type="button" role="radio" aria-checked={state.mode === 'agent'} aria-label={LABELS.agent}
                tabIndex={state.mode === 'agent' ? 0 : -1} disabled={state.agentDisabled && state.mode !== 'agent'} onClick={() => select('agent')}>
                <Tooltip label="Agent" side="bottom"><span className="chat-mode-switch-icon"><AgentIcon size={18} /></span><BetaBadge className="is-compact" /></Tooltip>
            </Button>
        </div>
    );
}
