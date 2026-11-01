/**
 * 外部工具同意方式：自动（只问标了「征求同意」的工具）/ 手动 / 全部允许。
 * 与运行模式并排放在 chin 行左端，只影响下一个任务创建时的工具确认策略。
 *
 * 'use client' 标记说明：
 * - 菜单键盘路径与焦点返回由共享 Menu 负责
 */
'use client';

import { ChevronDown } from 'lucide-react';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { AGENT_APPROVAL_LABELS, AGENT_APPROVAL_MODES, type AgentApprovalMode } from '@/lib/agent/mcp/config';

const HINTS: Record<AgentApprovalMode, string> = {
    auto: '只有标了「征求同意」的外部工具才先问你',
    manual: '调用任何外部工具之前都问你',
    allow_all: '外部工具直接调用，不再询问',
};

export function AgentApprovalMenu({ value, disabled, onChange }: {
    value: AgentApprovalMode;
    disabled?: boolean;
    onChange: (mode: AgentApprovalMode) => void;
}) {
    return (
        <Menu>
            <MenuTrigger className="chat-tool-text chat-run-mode-trigger" aria-label={`外部工具：${AGENT_APPROVAL_LABELS[value]}`} disabled={disabled}>
                <span>{AGENT_APPROVAL_LABELS[value]}</span><ChevronDown size={12} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent side="top" sideOffset={6} className="chat-plus-menu chat-run-mode-menu" aria-label="外部工具同意方式">
                <MenuRadioGroup value={value} onValueChange={mode => onChange(mode as AgentApprovalMode)}>
                    {AGENT_APPROVAL_MODES.map(mode => <MenuRadioItem key={mode} value={mode} title={HINTS[mode]} closeOnClick>
                        <span className="chat-plus-label">{AGENT_APPROVAL_LABELS[mode]}</span>
                    </MenuRadioItem>)}
                </MenuRadioGroup>
            </MenuContent>
        </Menu>
    );
}
