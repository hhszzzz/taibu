/**
 * Agent 运行模式：默认 / 计划 / 代码，同一时刻只有一种。
 *
 * 显示为一个按钮（当前模式 + 下拉箭头），点开与「+」同样式的弹窗选择，
 * 不在 chin 行并排铺三个分段控件。放在 chin 行左端，原「+」的位置。
 *
 * 'use client' 标记说明：
 * - 菜单键盘路径与焦点返回由共享 Menu 负责
 */
'use client';

import { ChevronDown } from 'lucide-react';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';

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
    const current = MODES.find(mode => mode.id === (codeMode ? 'code' : planMode ? 'plan' : 'default'))!;
    const select = (mode: AgentRunMode) => {
        onPlanModeChange(mode === 'plan');
        onCodeModeChange(mode === 'code');
    };
    return (
        <Menu>
            <MenuTrigger className="chat-tool-text chat-run-mode-trigger" aria-label={`运行模式：${current.label}`} disabled={disabled}>
                <span>{current.label}</span><ChevronDown size={12} aria-hidden="true" />
            </MenuTrigger>
            <MenuContent side="top" sideOffset={6} className="chat-plus-menu chat-run-mode-menu" aria-label="运行模式">
                <MenuRadioGroup value={current.id} onValueChange={value => select(value as AgentRunMode)}>
                    {MODES.map(mode => <MenuRadioItem key={mode.id} value={mode.id} title={mode.description} closeOnClick>
                        <span className="chat-plus-label">{mode.label}</span>
                    </MenuRadioItem>)}
                </MenuRadioGroup>
            </MenuContent>
        </Menu>
    );
}
