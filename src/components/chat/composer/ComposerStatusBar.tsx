/**
 * Composer 框外状态行（claude chin 行）：会话内左端是工具簇（+ / 知识库 / 联网等），右端是上下文环与模型·档位；
 * 首屏（hero）无工具簇，只有右端。用量已移到账户菜单「用量」二级。
 *
 * 「对话方式」已移到侧栏品牌行（components/chat/ModeSwitch.tsx）。
 *
 * 'use client' 标记说明：
 * - 模型菜单与自定义模型弹窗需要交互状态
 */
'use client';

import { useRef, useState } from 'react';
import { ChevronDown, KeyRound, X } from 'lucide-react';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { Button } from '@/components/ui/Button';
import { AgentModeMenu } from '@/components/chat/composer/AgentModeMenu';
import { CustomProviderPanel } from '@/components/chat/CustomProviderPanel';
import { Dialog } from '@/components/ui/Dialog';
import { AgentContextMeter } from '@/components/chat/agent/AgentContextUsage';
import type { AgentMessageData } from '@/lib/agent/types';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';

export interface ComposerStatusBarProps extends ModelSettingsProps {
    agentMode: boolean;
    disabled: boolean;
    userId?: string | null;
    selectedModel: string;
    onModelChange?: (modelId: string) => void;
    reasoningEnabled: boolean;
    onReasoningChange?: (enabled: boolean) => void;
    /** 本对话最近的 Agent 消息：chin 行尾的上下文环与弹层由它驱动。 */
    contextData?: AgentMessageData;
    /** 点开上下文弹层里的技能或方法卡。 */
    onOpenContextResource?: (id: string) => void;
    customProviderActive: boolean;
    customProviderLabel: string | null;
    /** 关闭自定义模型弹窗后的焦点落点（`+` 菜单按钮）。 */
    providerReturnRef?: React.RefObject<HTMLButtonElement | null>;
}

export function ComposerStatusBar(props: ComposerStatusBarProps) {
    const { agentMode, disabled, userId } = props;
    const providerReturnRef = useRef<HTMLButtonElement>(null);
    const [providerOpen, setProviderOpen] = useState(false);

    return (
        <div className="chat-composer-toolbar chat-composer-statusbar">
            {/* 运行模式固定在 chin 行左端（原「+」的位置）：一个按钮打开弹窗选择默认 / 计划 / 代码。 */}
            {agentMode && props.onPlanModeChange && props.onCodeModeChange && (
                <AgentModeMenu
                    planMode={!!props.planMode}
                    codeMode={!!props.codeMode}
                    disabled={disabled}
                    onPlanModeChange={props.onPlanModeChange}
                    onCodeModeChange={props.onCodeModeChange}
                />
            )}
            <span className="chat-toolbar-spacer" />
            {/* chin 中央免责声明：仅普通 chat 模式显示（Agent 模式不显示），hero 也不显示 */}
            {!agentMode && <span className="chat-composer-disclaimer">理性看待玄学</span>}
            <span className="chat-toolbar-spacer" />
            {props.customProviderActive ? (
                <Button unstyled ref={providerReturnRef} type="button" className="chat-model-trigger" aria-label={`自定义模型：${props.customProviderLabel || '未命名'}`}
                    aria-haspopup="dialog" aria-expanded={providerOpen} onClick={() => setProviderOpen(true)}>
                    <KeyRound size={15} aria-hidden="true" /><span className="chat-model-name">{props.customProviderLabel || '自定义模型'}</span><span className="chat-model-hint">自定义</span><ChevronDown size={14} aria-hidden="true" />
                </Button>
            ) : (
                <ModelSelector selectedModel={props.selectedModel} onModelChange={props.onModelChange}
                    reasoningEnabled={props.reasoningEnabled} onReasoningChange={props.onReasoningChange}
                    reasoningEffort={props.reasoningEffort} onReasoningEffortChange={props.onReasoningEffortChange}
                    collaborators={agentMode ? props.collaborators : undefined} onCollaboratorsChange={agentMode ? props.onCollaboratorsChange : undefined}
                    codeMode={agentMode ? props.codeMode : undefined} onCodeModeChange={agentMode ? props.onCodeModeChange : undefined}
                    planMode={agentMode ? props.planMode : undefined} onPlanModeChange={agentMode ? props.onPlanModeChange : undefined}
                    onCustomProvider={() => setProviderOpen(true)}
                    userId={userId} disabled={disabled} toolbarStyle />
            )}
            {/* 上下文环排在模型键之后（claude /code 实测：模型 → 环收尾在行尾） */}
            <AgentContextMeter data={props.contextData} onOpen={props.onOpenContextResource} />

            <Dialog bare open={providerOpen} onClose={() => setProviderOpen(false)} returnFocusRef={props.customProviderActive ? providerReturnRef : (props.providerReturnRef ?? undefined)} labelledBy="custom-provider-panel-title" className="chat-provider-dialog">
                <Button unstyled type="button" onClick={() => setProviderOpen(false)} aria-label="关闭自定义模型" className="agent-icon-button absolute right-3 top-3 z-10"><X size={17} /></Button>
                <CustomProviderPanel onClose={() => setProviderOpen(false)} />
            </Dialog>
        </div>
    );
}
