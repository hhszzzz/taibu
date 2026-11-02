/**
 * Composer 框外状态行（claude chin 行）：会话内左端是工具簇（+ / 知识库 / 联网等），右端是上下文环与模型·档位；
 * 首屏（hero）无工具簇，只有右端。用量已移到账户菜单「用量」二级。
 *
 * 「对话方式」已移到侧栏品牌行（components/chat/ModeSwitch.tsx）。
 *
 * 'use client' 标记说明：
 * - 模型菜单需要交互状态
 */
'use client';

import { ModelSelector } from '@/components/ui/ModelSelector';
import { AgentModeMenu } from '@/components/chat/composer/AgentModeMenu';
import { AgentApprovalMenu } from '@/components/chat/composer/AgentApprovalMenu';
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
}

export function ComposerStatusBar(props: ComposerStatusBarProps) {
    const { agentMode, disabled, userId } = props;

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
            {/* 外部工具的同意方式：自动 / 手动 / 全部允许。 */}
            {agentMode && props.onApprovalChange && (
                <AgentApprovalMenu value={props.approval ?? 'auto'} disabled={disabled} onChange={props.onApprovalChange} />
            )}
            <span className="chat-toolbar-spacer" />
            {/* chin 中央免责声明：仅普通 chat 模式显示（Agent 模式不显示），hero 也不显示 */}
            {!agentMode && <span className="chat-composer-disclaimer">理性看待玄学</span>}
            <span className="chat-toolbar-spacer" />
            <ModelSelector selectedModel={props.selectedModel} onModelChange={props.onModelChange}
                reasoningEnabled={props.reasoningEnabled} onReasoningChange={props.onReasoningChange}
                reasoningEffort={props.reasoningEffort} onReasoningEffortChange={props.onReasoningEffortChange}
                collaborators={agentMode ? props.collaborators : undefined} onCollaboratorsChange={agentMode ? props.onCollaboratorsChange : undefined}
                codeMode={agentMode ? props.codeMode : undefined} onCodeModeChange={agentMode ? props.onCodeModeChange : undefined}
                planMode={agentMode ? props.planMode : undefined} onPlanModeChange={agentMode ? props.onPlanModeChange : undefined}
                ownModelsEntry userId={userId} disabled={disabled} toolbarStyle />
            {/* 上下文环排在模型键之后（claude /code 实测：模型 → 环收尾在行尾） */}
            <AgentContextMeter data={props.contextData} onOpen={props.onOpenContextResource} />
        </div>
    );
}
