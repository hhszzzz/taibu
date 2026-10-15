/**
 * Workspace resources derived from persisted Agent parts.
 *
 * Every tool call maps to exactly one workspace location chosen by its tool
 * family (tool-catalog.ts): repeated calls about the same chart, record,
 * attachment or method share one tab, searches share the evidence view, and
 * plans or final selections live in the fixed process/results sections. The
 * panel follows the model by showing the location of the latest call. Nothing
 * here calculates, fetches or saves; views only read stored tool results.
 */
import type { ChatMessage } from '@/types';
import { isAgentRunTerminal, type AgentPart, type AgentRunStatus } from './types';
import type { AgentAnswers } from './questions';
import { AGENT_CHART_NAMES, getAgentToolFamily, isAgentChartTool, type AgentToolFamily } from './tool-catalog';
import { getAgentChart, getAgentDataResults, getAgentMethod, getAgentAttachmentRead, type AgentToolPart } from './tool-presentation';
import { CHART_SOURCE_KINDS, getAgentChartReference, getChartFocus, parseChartReference } from './chart-interaction';
import { getAgentEvidence, type AgentEvidence } from './evidence';

export type AgentWorkspaceSection = 'results' | 'process';
export const AGENT_WORKSPACE_SECTIONS: readonly AgentWorkspaceSection[] = ['results', 'process'];

export type AgentWorkspaceView =
  | 'chart' | 'saved' | 'calculation' | 'evidence' | 'data' | 'record' | 'profile' | 'attachment'
  | 'methods' | 'method' | 'question' | 'collaboration' | 'memory' | 'tool';

export interface AgentWorkspaceResource {
  id: string;
  view: AgentWorkspaceView;
  family: AgentToolFamily | 'saved' | 'attachment';
  title: string;
  /** Tool calls shown by this resource in transcript order; the last is the most recent. */
  toolIds: string[];
}

export interface AgentWorkspaceModel {
  resources: AgentWorkspaceResource[];
  tools: AgentToolPart[];
  toolsById: ReadonlyMap<string, AgentToolPart>;
  /** Tab or section for each tool call. */
  locations: ReadonlyMap<string, string>;
  /** Chart resource for each chart reference, so focus and reinspection reach the same tab. */
  chartResources: ReadonlyMap<string, string>;
  /** Everything the conversation's answers can cite, numbered in transcript order. */
  evidence: AgentEvidence[];
}

/** New events of these families open the workspace on desktop until the user closes it for that task. */
export const AGENT_WORKSPACE_AUTO_OPEN: readonly AgentToolFamily[] = ['chart', 'question', 'collaboration'];
/** The plan is already a compact bar in the chat; following it would pull the panel away on every update. */
const UNFOLLOWED: readonly AgentToolFamily[] = ['plan'];

type Artifact = Extract<AgentPart, { type: 'artifact' }>;

function chartReferenceOf(tool: AgentToolPart): string | null {
  const reference = getAgentChartReference(tool);
  if (reference || (tool.name !== 'inspect_chart' && tool.name !== 'focus_chart')) return reference;
  // Inspections and focus calls name their chart in the arguments before they finish.
  const parsed = parseChartReference(getChartFocus(tool)?.reference ?? inputText(tool, 'reference'));
  return parsed ? parsed.source + ':' + parsed.id : null;
}

/** Saved charts name their kind in the reference, so a pending inspection already has its title. */
function chartTitle(tool: AgentToolPart, reference: string | null): string {
  if (isAgentChartTool(tool.name)) return AGENT_CHART_NAMES[tool.name];
  const source = parseChartReference(reference)?.source;
  return source && source !== 'artifact' ? AGENT_CHART_NAMES[CHART_SOURCE_KINDS[source]] : tool.title;
}

function inputText(tool: AgentToolPart, key: string): string | null {
  const value = tool.input && typeof tool.input === 'object' ? (tool.input as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildAgentWorkspace({ parts, artifacts, attachmentIds }: { parts: AgentPart[]; artifacts: Artifact[]; attachmentIds: string[] }): AgentWorkspaceModel {
  const tools = parts.filter((part): part is AgentToolPart => part.type === 'tool');
  const resources = new Map<string, AgentWorkspaceResource>();
  const locations = new Map<string, string>();
  const chartResources = new Map<string, string>();
  const recordNames = new Map<string, string>();
  const attach = (id: string, tool: AgentToolPart) => {
    resources.get(id)!.toolIds.push(tool.id);
    locations.set(tool.id, id);
  };
  const add = (id: string, resource: Omit<AgentWorkspaceResource, 'id' | 'toolIds'>, tool?: AgentToolPart) => {
    const current = resources.get(id) ?? { id, ...resource, toolIds: [] };
    if (tool) {
      current.toolIds.push(tool.id);
      locations.set(tool.id, id);
    }
    resources.set(id, current);
    return current;
  };
  attachmentIds.forEach((id, index) => add('attachment:' + id, { view: 'attachment', family: 'attachment', title: `资料 ${index + 1}` }));
  for (const tool of tools) {
    const family = getAgentToolFamily(tool.name);
    switch (family) {
      case 'chart': {
        const reference = chartReferenceOf(tool);
        const known = reference ? chartResources.get(reference) : undefined;
        const chart = getAgentChart(tool);
        if (known) {
          attach(known, tool);
          if (chart) resources.get(known)!.title = chart.title;
          break;
        }
        // A focus call without a chart it can reach has nothing to show beyond its receipt.
        if (tool.name === 'focus_chart') { add('tool:' + tool.id, { view: 'tool', family, title: tool.title }, tool); break; }
        const id = 'tool:' + tool.id;
        add(id, { view: 'chart', family, title: chart?.title ?? chartTitle(tool, reference) }, tool);
        if (reference) chartResources.set(reference, id);
        break;
      }
      case 'calculation':
        add('tool:' + tool.id, { view: 'calculation', family, title: tool.title }, tool);
        break;
      case 'search':
        add('evidence', { view: 'evidence', family, title: '回答依据' }, tool);
        break;
      case 'data':
        if (tool.name === 'list_user_data') {
          for (const item of getAgentDataResults(tool)?.items ?? []) recordNames.set(item.type + ':' + item.id, item.name);
          add('data', { view: 'data', family, title: '个人资料' }, tool);
        } else if (tool.name === 'read_user_profile') add('profile', { view: 'profile', family, title: '个性化档案' }, tool);
        else if (tool.name === 'read_attachment') {
          const id = inputText(tool, 'id') ?? tool.id;
          const name = getAgentAttachmentRead(tool)?.name;
          const resource = add('attachment:' + id, { view: 'attachment', family: 'attachment', title: name ?? '资料' }, tool);
          if (name) resource.title = name;
        } else {
          const key = (inputText(tool, 'type') ?? 'record') + ':' + (inputText(tool, 'id') ?? tool.id);
          add('record:' + key, { view: 'record', family, title: recordNames.get(key) ?? '资料记录' }, tool);
        }
        break;
      case 'method':
        if (tool.name === 'list_analysis_methods') add('methods', { view: 'methods', family, title: '分析方法' }, tool);
        else {
          const resource = add('method:' + (inputText(tool, 'id') ?? tool.id), { view: 'method', family, title: '解读指引' }, tool);
          const guide = getAgentMethod(tool);
          if (guide) resource.title = guide.title;
        }
        break;
      case 'plan':
        locations.set(tool.id, 'process');
        break;
      case 'artifacts':
        locations.set(tool.id, 'results');
        break;
      case 'question':
        add('question:' + tool.id, { view: 'question', family, title: '补充信息' }, tool);
        break;
      case 'collaboration':
        add('tool:' + tool.id, { view: 'collaboration', family, title: '协作分析' }, tool);
        break;
      case 'memory':
        add('memory', { view: 'memory', family, title: '长期记忆' }, tool);
        break;
      default:
        add('tool:' + tool.id, { view: 'tool', family, title: tool.title }, tool);
    }
  }
  for (const artifact of artifacts) add('chart:' + artifact.id, { view: 'saved', family: 'saved', title: artifact.title });
  return { resources: [...resources.values()], tools, toolsById: new Map(tools.map(tool => [tool.id, tool])), locations, chartResources, evidence: getAgentEvidence(tools) };
}

/** `cite:<n>` names a citation in an answer; anything else is not one. */
export function parseAgentCitationTarget(id: string): number | null {
  const match = /^cite:([1-9]\d{0,8})$/u.exec(id);
  return match ? Number(match[1]) : null;
}

/**
 * Normalizes a requested location: a tool ID reaches the tab that shows it, a
 * source reaches the evidence view, and a citation reaches the evidence view or,
 * when the task never searched, the chart position it cites. Unknown IDs resolve to null.
 */
export function resolveAgentWorkspaceLocation(model: AgentWorkspaceModel, id: string): string | null {
  if ((AGENT_WORKSPACE_SECTIONS as readonly string[]).includes(id)) return id;
  if (model.resources.some(resource => resource.id === id)) return id;
  if (id.startsWith('tool:')) return model.locations.get(id.slice(5)) ?? null;
  const evidence = model.resources.some(resource => resource.id === 'evidence');
  if (id.startsWith('source:') && evidence) return 'evidence';
  const cite = parseAgentCitationTarget(id);
  const item = cite === null ? undefined : model.evidence.find(entry => entry.n === cite);
  if (item) return evidence ? 'evidence' : model.locations.get(item.toolId) ?? null;
  return null;
}

/** The location of the model's latest tool call; plans stay in the chat. */
export function getAgentWorkspaceFollowTarget(model: AgentWorkspaceModel): string | null {
  for (let index = model.tools.length - 1; index >= 0; index--) {
    const tool = model.tools[index];
    if (UNFOLLOWED.includes(getAgentToolFamily(tool.name))) continue;
    const location = model.locations.get(tool.id);
    if (location) return location;
  }
  return null;
}

/** The model is working; only then can the panel be told to follow it. */
export function isAgentRunWorking(status: AgentRunStatus | null): boolean {
  return status === 'queued' || status === 'running' || status === 'cancelling';
}

/**
 * Fixed sections before the resource tabs, given the latest task's status (null
 * without a task): 过程 whenever there is a task, 概览 once nothing runs.
 */
export function getAgentWorkspaceSections(status: AgentRunStatus | null): AgentWorkspaceSection[] {
  if (status === null) return ['results'];
  return isAgentRunTerminal(status) ? ['results', 'process'] : ['process'];
}

/**
 * Where the panel is. Following the model shows its latest call while the task
 * runs or waits for an answer, and the overview once it has ended; otherwise
 * the reader's own choice. A section that is not shown falls back to the first one that is.
 */
export function getAgentWorkspaceLocation(model: AgentWorkspaceModel, { selected, followModel, status }: {
  selected: string | null; followModel: boolean; status: AgentRunStatus | null;
}): string {
  const sections = getAgentWorkspaceSections(status);
  const ended = status === null || isAgentRunTerminal(status);
  const requested = !followModel ? selected : ended ? 'results' : getAgentWorkspaceFollowTarget(model) ?? selected;
  const location = requested ? resolveAgentWorkspaceLocation(model, requested) : null;
  if (location === null) return sections[0];
  return (AGENT_WORKSPACE_SECTIONS as readonly string[]).includes(location) && !(sections as readonly string[]).includes(location) ? sections[0] : location;
}

/**
 * Identity of the newest workspace event that may open the panel on its own:
 * a chart reading or focus, a question, or a collaboration. A changed key means a new event.
 */
export function getAgentWorkspaceAutoOpenEvent(parts: AgentPart[]): string | null {
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (part.type !== 'tool' || !AGENT_WORKSPACE_AUTO_OPEN.includes(getAgentToolFamily(part.name))) continue;
    if (getAgentToolFamily(part.name) === 'chart' && !getChartFocus(part) && !getAgentChart(part)) continue;
    return part.id;
  }
  return null;
}

export interface AgentQuestionAnswer { content: string; answers?: AgentAnswers }

/** Replies are user messages carrying the question ID they answered. */
export function getAgentQuestionAnswers(messages: ChatMessage[]): ReadonlyMap<string, AgentQuestionAnswer> {
  const answers = new Map<string, AgentQuestionAnswer>();
  for (const message of messages) {
    const questionId = message.metadata?.agentQuestionId;
    if (message.role !== 'user' || typeof questionId !== 'string') continue;
    const value = message.metadata?.agentAnswers;
    const valid = value && typeof value === 'object' && !Array.isArray(value) &&
      Object.values(value).every(answer => answer === null || (Array.isArray(answer) && answer.every(item => typeof item === 'string')));
    answers.set(questionId, { content: message.content, ...(valid ? { answers: value as AgentAnswers } : {}) });
  }
  return answers;
}

/** ask_user cards are followed by the question part their call created. */
export function getAgentToolQuestionIds(parts: AgentPart[]): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  let lastAsk: string | null = null;
  for (const part of parts) {
    if (part.type === 'tool') lastAsk = part.name === 'ask_user' ? part.id : null;
    else if (part.type === 'question' && lastAsk) { ids.set(lastAsk, part.id); lastAsk = null; }
  }
  return ids;
}
