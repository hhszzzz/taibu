import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';

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
}

export interface NextTaskConfiguration {
  model: string;
  reasoning: boolean;
  reasoningEffort: AIReasoningEffort | null;
  webEnabled: boolean;
  collaborators: AgentCollaborator[];
}

export interface ModelSettingsProps {
  reasoningEffort?: AIReasoningEffort | null;
  onReasoningEffortChange?: (effort: AIReasoningEffort | null) => void;
  collaborators?: AgentCollaborator[];
  onCollaboratorsChange?: (members: AgentCollaborator[]) => void;
}

export function parseReasoningEffort(value: unknown): AIReasoningEffort | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !AI_REASONING_EFFORTS.includes(value as AIReasoningEffort)) throw new Error('推理档位无效');
  return value as AIReasoningEffort;
}

export function parseAgentCollaborators(value: unknown): AgentCollaborator[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || (value.length !== 0 && (value.length < 2 || value.length > 4))) throw new Error('协作 Agent 需要 2–4 个成员');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('协作 Agent 配置无效');
    const { id, name, model, focus, reasoning } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id) ||
      typeof name !== 'string' || !name.trim() || name.length > 60 ||
      typeof model !== 'string' || !model.trim() || model.length > 200 ||
      typeof focus !== 'string' || focus.length > 1200 || typeof reasoning !== 'boolean') throw new Error('协作 Agent 配置无效');
    ids.add(id);
    return { id, name: name.trim(), model: model.trim(), focus: focus.trim(), reasoning,
      reasoningEffort: parseReasoningEffort((item as Record<string, unknown>).reasoningEffort) };
  });
}

export function parseNextTaskConfiguration(value: unknown): NextTaskConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置无效');
  const input = value as Record<string, unknown>;
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 ||
    typeof input.reasoning !== 'boolean' || typeof input.webEnabled !== 'boolean') throw new Error('配置无效');
  return { model: input.model.trim(), reasoning: input.reasoning, webEnabled: input.webEnabled,
    reasoningEffort: parseReasoningEffort(input.reasoningEffort), collaborators: parseAgentCollaborators(input.collaborators) };
}
