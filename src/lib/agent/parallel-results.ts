// Type aliases, not interfaces: tool details must stay assignable to Durable's JSON value type.
/** A tool call a member made, shown while it analyses. */
export type ParallelMemberStep = { name: string; title: string; status: 'running' | 'completed' | 'failed' };

export type ParallelAnalysisResult = {
  system: string;
  conversationId: number;
  status: 'running' | 'completed' | 'failed';
  agentId?: string;
  name?: string;
  modelName?: string;
  model?: string;
  /** Effort the child conversation was configured with; 'off' when reasoning is disabled. */
  reasoningEffort?: string;
  /** The user's configured division of work for this member. */
  focus?: string;
  answer?: string;
  /** The member's stance on each topic, keyed by topic title; option topics hold one of their options. */
  positions?: Record<string, string>;
  /** Tool calls the member's analysis made, counted from its transcript. */
  toolCalls?: number;
  /** From the member's first input to its final answer, from transcript timestamps. */
  durationMs?: number;
  /** The member's calls so far while it analyses. */
  steps?: ParallelMemberStep[];
};

/** A question every member answers; with options, members pick one and disagreement can be compared. */
export type ParallelTopic = { title: string; options?: string[] };

export const PARALLEL_TOPIC_LIMIT = 4;
const OPTIONAL_TEXT = ['agentId', 'name', 'modelName', 'model', 'reasoningEffort', 'focus', 'answer'] as const;
const STEP_STATES: readonly string[] = ['running', 'completed', 'failed'] satisfies ParallelMemberStep['status'][];
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parallelAnalysisResults(value: unknown): ParallelAnalysisResult[] {
  if (!isRecord(value)) return [];
  const analyses = value.analyses;
  if (!Array.isArray(analyses) || analyses.length > 4) return [];
  return analyses.filter((item): item is ParallelAnalysisResult => isRecord(item) &&
    typeof item.system === 'string' && typeof item.conversationId === 'number' &&
    ['running', 'completed', 'failed'].includes(item.status as string) &&
    OPTIONAL_TEXT.every(key => item[key] === undefined || typeof item[key] === 'string'))
    // Display-only fields are dropped when malformed; the member itself stays.
    .map(({ positions, toolCalls, durationMs, steps, ...member }) => ({
      ...member,
      ...(isRecord(positions) && Object.values(positions).every(position => typeof position === 'string') ? { positions: positions as Record<string, string> } : {}),
      ...(isCount(toolCalls) ? { toolCalls } : {}),
      ...(isCount(durationMs) ? { durationMs } : {}),
      ...(Array.isArray(steps) && steps.every(step => isRecord(step) && typeof step.name === 'string' && typeof step.title === 'string' && STEP_STATES.includes(step.status as string)) ? { steps } : {}),
    }));
}

/** Topics the parent asked members to take a stance on; malformed topics are ignored. */
export function parallelAnalysisTopics(value: unknown): ParallelTopic[] {
  const topics = isRecord(value) ? value.topics : undefined;
  if (!Array.isArray(topics)) return [];
  return topics.filter((topic): topic is ParallelTopic => isRecord(topic) && typeof topic.title === 'string' && topic.title.trim() !== '' &&
    (topic.options === undefined || (Array.isArray(topic.options) && topic.options.length >= 2 && topic.options.every(option => typeof option === 'string'))))
    .slice(0, PARALLEL_TOPIC_LIMIT);
}

/** Trims the topics the model named; empty or repeated titles and options are an error the model can correct. */
export function normalizeParallelTopics(topics: readonly ParallelTopic[] = []): ParallelTopic[] {
  const normalized = topics.map(topic => ({ title: topic.title.trim(), ...(topic.options ? { options: topic.options.map(option => option.trim()) } : {}) }));
  if (normalized.length > PARALLEL_TOPIC_LIMIT || new Set(normalized.map(topic => topic.title)).size !== normalized.length ||
    normalized.some(topic => !topic.title || topic.options?.some(option => !option) || new Set(topic.options).size !== (topic.options?.length ?? 0)))
    throw new Error('协作议题和选项不能为空或重复');
  return normalized;
}

/** The heading the parent gave this collaboration, such as 三派会诊. */
export function parallelAnalysisTitle(value: unknown): string | null {
  const title = isRecord(value) ? value.title : undefined;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

const POSITION_OPEN = '<positions>';
const POSITION_CLOSE = '</positions>';
/** Free-text stances are short summaries; anything longer is prose, not a stance. */
const POSITION_LENGTH = 24;

/**
 * A member ends its answer with one `议题：立场` line per topic inside
 * <positions>. Option topics accept only one of their options (or a line that
 * starts with exactly one of them); unknown topics and repeats are ignored.
 */
export function splitMemberPositions(text: string, topics: readonly ParallelTopic[]): { answer: string; positions: Record<string, string> } {
  const start = text.lastIndexOf(POSITION_OPEN);
  if (start < 0) return { answer: text, positions: {} };
  const end = text.indexOf(POSITION_CLOSE, start + POSITION_OPEN.length);
  const positions: Record<string, string> = {};
  for (const line of text.slice(start + POSITION_OPEN.length, end < 0 ? undefined : end).split('\n')) {
    const match = /^\s*(?:[-*•]\s*)?([^：:]+?)\s*[：:]\s*(.+?)\s*$/u.exec(line);
    const topic = match && topics.find(item => item.title === match[1]);
    if (!match || !topic || Object.hasOwn(positions, topic.title)) continue;
    const stance = match[2];
    const option = topic.options?.includes(stance) ? stance : topic.options?.filter(item => stance.startsWith(item));
    if (typeof option === 'string') positions[topic.title] = option;
    else if (option?.length === 1) positions[topic.title] = option[0];
    else if (!topic.options && stance.length <= POSITION_LENGTH) positions[topic.title] = stance;
  }
  const answer = text.slice(0, start).trimEnd();
  const rest = end < 0 ? '' : text.slice(end + POSITION_CLOSE.length).trim();
  return { answer: rest ? (answer ? `${answer}\n\n${rest}` : rest) : answer, positions };
}

export interface ParallelDivergenceRow {
  topic: ParallelTopic;
  /** One cell per member, in member order: its stance, or null while it has none. */
  stances: Array<string | null>;
  /** Members that finished picked different options; free-text topics are never compared. */
  divergent: boolean;
}

export function getParallelDivergence(topics: readonly ParallelTopic[], members: readonly ParallelAnalysisResult[]): ParallelDivergenceRow[] {
  return topics.map(topic => {
    const stances = members.map(member => member.positions?.[topic.title] ?? null);
    const chosen = new Set(members.flatMap((member, index) => member.status === 'completed' && stances[index] !== null ? [stances[index]] : []));
    return { topic, stances, divergent: !!topic.options && chosen.size > 1 };
  });
}

/** Members finished out of those analysing while the task's latest collaboration runs; null otherwise. */
export function collaborationProgress(parts: ReadonlyArray<{ type: string; name?: string; status?: string; output?: unknown }>, configured = 0): { completed: number; total: number } | null {
  const tool = parts.findLast(part => part.type === 'tool' && part.name === 'parallel_analysis');
  if (!tool || (tool.status !== 'pending' && tool.status !== 'running')) return null;
  const results = parallelAnalysisResults(tool.output);
  const total = Math.max(configured, results.length);
  return total ? { completed: results.filter(result => result.status !== 'running').length, total } : null;
}
