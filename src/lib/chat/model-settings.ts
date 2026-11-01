import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import { AGENT_PROFILE_NAME_PATTERN } from '@/lib/agent/profiles/config';
import { parseAgentApproval, type AgentApprovalMode } from '@/lib/agent/mcp/config';

export const REASONING_EFFORT_LABELS: Record<AIReasoningEffort, string> = {
  minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高',
};

export interface AgentCollaborator {
  id: string;
  name: string;
  model: string;
  focus: string;
  reasoning: boolean;
  reasoningEffort: AIReasoningEffort | null;
  /** The member's role (profiles/config.ts); absent: the specialist. */
  profile?: string;
}

export interface NextTaskConfiguration {
  model: string;
  reasoning: boolean;
  reasoningEffort: AIReasoningEffort | null;
  webEnabled: boolean;
  /** Agent 代码模式：模型可写脚本批量调用工具；每个任务创建时固定。 */
  codeMode: boolean;
  /** Agent 计划模式：模型先提交分析计划，用户批准后再执行；每个任务创建时固定。 */
  planMode: boolean;
  /** 外部工具是否先征求同意：自动 / 手动 / 全部允许。 */
  approval: AgentApprovalMode;
  collaborators: AgentCollaborator[];
}

export interface ModelSettingsProps {
  reasoningEffort?: AIReasoningEffort | null;
  onReasoningEffortChange?: (effort: AIReasoningEffort | null) => void;
  collaborators?: AgentCollaborator[];
  onCollaboratorsChange?: (members: AgentCollaborator[]) => void;
  codeMode?: boolean;
  onCodeModeChange?: (enabled: boolean) => void;
  planMode?: boolean;
  onPlanModeChange?: (enabled: boolean) => void;
  approval?: AgentApprovalMode;
  onApprovalChange?: (mode: AgentApprovalMode) => void;
}

export function parseReasoningEffort(value: unknown): AIReasoningEffort | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !AI_REASONING_EFFORTS.includes(value as AIReasoningEffort)) throw new Error('推理档位无效');
  return value as AIReasoningEffort;
}

export function parseAgentCollaborators(value: unknown): AgentCollaborator[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error('协作 Agent 最多 4 个成员');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('协作 Agent 配置无效');
    const { id, name, model, focus, reasoning, profile } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id) ||
      typeof name !== 'string' || !name.trim() || name.length > 60 ||
      typeof model !== 'string' || !model.trim() || model.length > 200 ||
      typeof focus !== 'string' || focus.length > 1200 || typeof reasoning !== 'boolean' ||
      (profile !== undefined && (typeof profile !== 'string' || !AGENT_PROFILE_NAME_PATTERN.test(profile)))) throw new Error('协作 Agent 配置无效');
    ids.add(id);
    return { id, name: name.trim(), model: model.trim(), focus: focus.trim(), reasoning,
      reasoningEffort: parseReasoningEffort((item as Record<string, unknown>).reasoningEffort), ...(profile === undefined ? {} : { profile }) };
  });
}

export function parseNextTaskConfiguration(value: unknown): NextTaskConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置无效');
  const input = value as Record<string, unknown>;
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 ||
    typeof input.reasoning !== 'boolean' || typeof input.webEnabled !== 'boolean' ||
    (input.codeMode !== undefined && typeof input.codeMode !== 'boolean') ||
    (input.planMode !== undefined && typeof input.planMode !== 'boolean')) throw new Error('配置无效');
  // 代码模式与计划模式、推理档位、协作成员一样有缺省值：缺省为关闭。
  return { model: input.model.trim(), reasoning: input.reasoning, webEnabled: input.webEnabled, codeMode: input.codeMode === true, planMode: input.planMode === true,
    approval: parseAgentApproval(input.approval),
    reasoningEffort: parseReasoningEffort(input.reasoningEffort), collaborators: parseAgentCollaborators(input.collaborators) };
}

/** 新对话的初始配置：沿用模型、推理、联网、代码模式与计划模式，协作成员一律从 0 开始，只有用户在该对话勾选后才协作。 */
export function freshTaskConfiguration(base: NextTaskConfiguration): NextTaskConfiguration {
  return { ...base, collaborators: [] };
}
