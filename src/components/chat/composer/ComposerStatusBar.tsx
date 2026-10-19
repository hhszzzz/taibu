/**
 * Composer 框外状态行（claude chin 行）：会话内左端是工具簇（+ / 知识库 / 联网等），右端是上下文度量与模型·档位；
 * 首屏（hero）无工具簇，只有右端。
 *
 * 「对话方式」已移到侧栏品牌行（components/chat/ModeSwitch.tsx）。
 *
 * 'use client' 标记说明：
 * - 模型菜单与自定义模型弹窗需要交互状态
 */
'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown, KeyRound, X } from 'lucide-react';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { CustomProviderPanel } from '@/components/chat/CustomProviderPanel';
import { Modal } from '@/components/ui/Modal';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { ContextRing } from '@/components/chat/agent/AgentContextUsage';
import { pricingPlans } from '@/lib/user/membership';
import type { MembershipType } from '@/lib/user/membership';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';

export interface ComposerUsage {
    credits: number;
    membershipType: MembershipType;
}

/** claude /code 实测：chin 行尾 = 模型键 + 24px 用量环；环打开 312px 用量浮层。 */
function UsageRing({ usage }: { usage: ComposerUsage }) {
    const anchor = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const planLimit = pricingPlans.find(plan => plan.id === usage.membershipType)?.creditLimit ?? 10;
    // 奖励积分可以超过套餐上限；分母取两者较大值，避免出现 52 / 10 这类读数。
    const limit = Math.max(planLimit, usage.credits);
    // 环显示「已用额度」占比（claude 用量环同义）；剩余值写在 aria-label 与浮层里。
    const used = Math.max(0, limit - usage.credits);
    const percent = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
    return <>
        <button ref={anchor} type="button" className="chat-context-meter" aria-label={`用量：剩余 ${usage.credits} / ${limit} 积分`}
            aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>
            <ContextRing percent={percent} size={18} />
        </button>
        <FloatingPanel open={open} anchorRef={anchor} onClose={() => setOpen(false)} label="用量" role="dialog" side="top" align="end" className="chat-context-panel">
            <header className="chat-context-head"><strong>用量</strong><span>积分 · {usage.membershipType === 'free' ? 'Free' : usage.membershipType === 'plus' ? 'Plus' : 'Pro'}</span></header>
            <div className="chat-context-divider" />
            <dl className="chat-context-section">
                <div className="chat-context-row"><dt>剩余积分</dt><dd>{usage.credits} / {limit}</dd></div>
            </dl>
            <div className="chat-context-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
            <p className="chat-model-note">每次平台模型对话消耗 1 积分；签到与升级可补充。</p>
        </FloatingPanel>
    </>;
}

export interface ComposerStatusBarProps extends ModelSettingsProps {
    agentMode: boolean;
    disabled: boolean;
    userId?: string | null;
    membershipType: MembershipType;
    selectedModel: string;
    onModelChange?: (modelId: string) => void;
    reasoningEnabled: boolean;
    onReasoningChange?: (enabled: boolean) => void;
    /** 平台积分用量环（claude chin 行尾的用量圈）。 */
    usage?: ComposerUsage;
    customProviderActive: boolean;
    customProviderLabel: string | null;
    /** 关闭自定义模型弹窗后的焦点落点（`+` 菜单按钮）。 */
    providerReturnRef?: React.RefObject<HTMLButtonElement | null>;
    /** 行首槽位：会话内的工具簇（+ / 知识库 / 联网等）排在 chin 行左端（claude /chat 实测）。 */
    leading?: ReactNode;
}

export function ComposerStatusBar(props: ComposerStatusBarProps) {
    const { agentMode, disabled, userId } = props;
    const providerReturnRef = useRef<HTMLButtonElement>(null);
    const [providerOpen, setProviderOpen] = useState(false);

    return (
        <div className="chat-composer-toolbar chat-composer-statusbar">
            {props.leading}
            <span className="chat-toolbar-spacer" />
            {/* chin 中央免责声明：仅普通 chat 模式显示（Agent 模式不显示），hero 也不显示 */}
            {!agentMode && <span className="chat-composer-disclaimer">理性看待玄学</span>}
            <span className="chat-toolbar-spacer" />
            {props.customProviderActive ? (
                <button ref={providerReturnRef} type="button" className="chat-model-trigger" aria-label={`自定义模型：${props.customProviderLabel || '未命名'}`}
                    aria-haspopup="dialog" aria-expanded={providerOpen} onClick={() => setProviderOpen(true)}>
                    <KeyRound size={15} aria-hidden="true" /><span className="chat-model-name">{props.customProviderLabel || '自定义模型'}</span><span className="chat-model-hint">自定义</span><ChevronDown size={14} aria-hidden="true" />
                </button>
            ) : (
                <ModelSelector selectedModel={props.selectedModel} onModelChange={props.onModelChange}
                    reasoningEnabled={props.reasoningEnabled} onReasoningChange={props.onReasoningChange}
                    reasoningEffort={props.reasoningEffort} onReasoningEffortChange={props.onReasoningEffortChange}
                    collaborators={agentMode ? props.collaborators : undefined} onCollaboratorsChange={agentMode ? props.onCollaboratorsChange : undefined}
                    onCustomProvider={() => setProviderOpen(true)}
                    userId={userId} membershipType={props.membershipType} disabled={disabled} toolbarStyle />
            )}
            {/* 用量环排在模型键之后（claude /code 实测：模型 → 环收尾在行尾） */}
            {props.usage && <UsageRing usage={props.usage} />}

            <Modal open={providerOpen} onClose={() => setProviderOpen(false)} returnFocusRef={props.customProviderActive ? providerReturnRef : (props.providerReturnRef ?? undefined)} labelledBy="custom-provider-panel-title" className="chat-provider-dialog">
                <button type="button" onClick={() => setProviderOpen(false)} aria-label="关闭自定义模型" className="agent-icon-button absolute right-3 top-3 z-10"><X size={17} /></button>
                <CustomProviderPanel onClose={() => setProviderOpen(false)} />
            </Modal>
        </div>
    );
}
