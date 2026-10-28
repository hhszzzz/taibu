import 'server-only';
import { configure, defineDoc, defineTool, type AgentChange, type ConversationId, type ConversationWatch, type Extension, type Harness } from '@earendil-works/pi-durable';
import { Type, type Message } from '@earendil-works/pi-ai';
import { ANALYSIS_METHODS } from './methods.server';
import { PARALLEL_TOPIC_LIMIT, normalizeParallelTopics, splitMemberPositions, type ParallelAnalysisResult, type ParallelMemberStep, type ParallelTopic } from './parallel-results';
import { DEFAULT_AGENT_PROFILE, type AgentProfileView } from './profiles/config';
import { systemTitle, type MemberKit, type MemberSetup } from './profiles/members.server';
import type { AgentCollaborator } from '@/lib/chat/model-settings';
import type { AIModelConfig } from '@/types';
import { DEFAULT_DIVINATION_TIMEZONE } from 'taibu-core/timezone-utils';
import { sentAtLine } from '@/lib/ai/prompt-time';
import { resolveThinkingLevel } from '@/lib/ai/thinking';

// At most four children, written in one commit: deltas only.
const ParallelDoc = defineDoc({ kind: 'taibu.parallel', version: 1, scope: 'task', initial: (): { children: number[] } => ({ children: [] }), checkpointWhen: () => false });
/**
 * A method that reads a chart, by id (a system such as bazi, or a school such as bazi-mangpai). A technique
 * (birth-hour) only joins a system card, so it is never given on its own.
 */
export const PARALLEL_SYSTEMS = ANALYSIS_METHODS.filter(method => method.tools.length && method.kind !== 'technique').map(method => method.id);

/**
 * A member conversation's agent: its role's tools, all offered at once because it has no tool search to load deferred
 * ones, without the extension that dispatched it, so it cannot nest, with its instructions and, when the role has one,
 * its model.
 */
export function memberAgentChange(setup: MemberSetup, dispatcher: Extension): AgentChange {
    return {
        ...(setup.model ? { model: { provider: 'taibu', modelId: setup.model.config.id }, thinkingLevel: setup.model.thinkingLevel } : {}),
        extensions: { remove: [dispatcher] }, tools: setup.tools, modelTools: setup.tools, instructions: setup.instructions,
    };
}

/** What a member is called in the main agent's lists: its role, and the method it was given. */
export function memberTitle(profile: Pick<AgentProfileView, 'name' | 'displayName'> | undefined, system?: string): string {
    if (!profile || profile.name === DEFAULT_AGENT_PROFILE) return system ? systemTitle(system) : '体系专家';
    return system ? `${profile.displayName}·${systemTitle(system)}` : profile.displayName;
}

const STEP_LIMIT = 12;
/** Display bounds for a member's process: its calls ride in the card's details, never in the parent model's context. */
const STEP_NOTE_LIMIT = 400;
const STEP_INPUT_LIMIT = 800;
const STEP_OUTPUT_LIMIT = 3000;
const LABEL = { minLength: 1, maxLength: 12 };

/**
 * The member's tool calls with their outcome, newest last: the words it said before each call, the arguments,
 * and what the tool returned, bounded for display.
 */
export function memberSteps(messages: readonly Message[], titles: ReadonlyMap<string, string>): ParallelMemberStep[] {
    const results = new Map(messages.flatMap(message => message.role === 'toolResult' ? [[message.toolCallId, message] as const] : []));
    return messages.flatMap(message => {
        if (message.role !== 'assistant') return [];
        let said = '';
        return message.content.flatMap(part => {
            if (part.type === 'text') said += part.text;
            if (part.type !== 'toolCall') return [];
            const note = said.trim().slice(0, STEP_NOTE_LIMIT);
            said = '';
            const input = JSON.stringify(part.arguments ?? {});
            const result = results.get(part.id);
            const text = result?.content.flatMap(item => item.type === 'text' ? [item.text] : []).join('\n').trim() ?? '';
            return [{
                name: part.name, title: titles.get(part.name) ?? part.name,
                status: !result ? 'running' as const : result.isError ? 'failed' as const : 'completed' as const,
                ...(note ? { note } : {}),
                ...(input !== '{}' && input.length <= STEP_INPUT_LIMIT ? { input } : {}),
                ...(text ? { output: text.slice(0, STEP_OUTPUT_LIMIT), ...(text.length > STEP_OUTPUT_LIMIT ? { truncated: true } : {}) } : {}),
            }];
        });
    }).slice(-STEP_LIMIT);
}

/** Calls made and time from the member's input to its last message, read from timestamps so a replay reports the same. */
export function memberStats(messages: readonly Message[]): { toolCalls: number; durationMs?: number } {
    const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const start = messages.find(message => message.role === 'user')?.timestamp;
    const end = Math.max(...messages.map(message => valid(message.timestamp) ? message.timestamp + (message.role === 'assistant' && valid(message.durationMs) ? message.durationMs : 0) : -1));
    return { toolCalls: messages.filter(message => message.role === 'toolResult').length, ...(valid(start) && end >= start ? { durationMs: end - start } : {}) };
}

/** The rule appended to each member's task when the parent asks for stances it can compare. */
export function positionsInstruction(topics: readonly ParallelTopic[]) {
    if (!topics.length) return '';
    return `\n\n回答最后另起一行写 <positions>，每个议题一行“议题：立场”，最后一行写 </positions>。${topics.map(topic => topic.options
        ? `「${topic.title}」只能从 ${topic.options.join(' / ')} 中原样选择一项`
        : `「${topic.title}」用不超过 12 个字概括`).join('；')}。`;
}

/**
 * Children belong to this ToolTask, so aborts cascade and recovery reuses its native receipts. Each member's task is
 * dated in the user's time zone, as the user's own messages are. A member works as a role (profiles/); one the user
 * configured keeps the role and model they chose for it, unless the role has its own model.
 */
export function createParallelExtension(kit: MemberKit, session: () => Harness, collaborators: readonly AgentCollaborator[] = [], models: ReadonlyMap<string, AIModelConfig> = new Map(), titles: ReadonlyMap<string, string> = new Map(), timeZone = DEFAULT_DIVINATION_TIMEZONE): Extension {
    const memberEffort = (member: AgentCollaborator) => member.reasoning ? resolveThinkingLevel(models.get(member.model) ?? {}, member.reasoningEffort) : 'off';
    const roles = kit.roles('parallel');
    const roleOf = (member: AgentCollaborator) => member.profile ?? DEFAULT_AGENT_PROFILE;
    const extension: Extension = { name: 'taibu_parallel', tools: [defineTool({
        name: 'parallel_analysis', description: `同时交给 1–4 位成员分头处理相互独立的子问题，并等待全部完成。每位成员按角色 agent 工作：${kit.describe('parallel')}。agent 不填即 ${DEFAULT_AGENT_PROFILE}，此时必须填 system（方法 id，同一体系可从不同角度或用不同流派的方法分析，如 bazi 与 bazi-mangpai）；其他角色给了 system 时以该方法为准。先确认每项必要资料完整；成员只完成所给子问题，由当前任务核对与汇总，整项任务仅计一次费用。${collaborators.length ? `每项必须填写用户配置的 agentId，且包含全部成员：${collaborators.map(member => `${member.id}（${member.name}，角色 ${roleOf(member)}：${member.focus}）`).join('；')}` : ''}`,
        parameters: Type.Object({ tasks: Type.Array(Type.Object({
          agent: Type.Optional(Type.String({ enum: roles.map(role => role.name), description: '成员的角色，默认 specialist' })),
          system: Type.Optional(Type.String({ enum: PARALLEL_SYSTEMS, description: '方法 id；specialist 必填' })),
          question: Type.String({ minLength: 1, maxLength: 4000 }),
          agentId: Type.Optional(Type.String(collaborators.length ? { enum: collaborators.map(member => member.id) } : {})),
          name: Type.Optional(Type.String({ ...LABEL, description: '这位成员在本任务里的称呼，如“格局派”“应期复核”；未配置协作成员时按分工起名' })) }), { minItems: 1, maxItems: 4 }),
          title: Type.Optional(Type.String({ ...LABEL, description: '这次协作的简短标题，如“三派会诊”' })),
          topics: Type.Optional(Type.Array(Type.Object({ title: Type.String(LABEL), options: Type.Optional(Type.Array(Type.String(LABEL), { minItems: 2, maxItems: 4 })) }), {
            maxItems: PARALLEL_TOPIC_LIMIT, description: '需要每位成员表态的关键议题；给出 options 时成员只能原样选择一项，用于对照分歧' })) }),
        // Only the model dispatches members; a code mode script cannot.
        replay: 'safe', executionMode: 'sequential', callers: ['model'],
        execute: async (args, api, context) => {
            if (collaborators.length && (args.tasks.length !== collaborators.length || new Set(args.tasks.map(task => task.agentId)).size !== collaborators.length || args.tasks.some(task => !collaborators.some(member => member.id === task.agentId)))) throw new Error('协作分析必须包含全部已配置的 Agent，不能重复或使用未配置的模型');
            if (!collaborators.length && args.tasks.some(task => task.agentId !== undefined)) throw new Error('未配置协作 Agent');
            const topics = normalizeParallelTopics(args.topics);
            const summary = { ...(args.title?.trim() ? { title: args.title.trim() } : {}), ...(topics.length ? { topics } : {}) };
            // Each member's role, tools and instructions, read before the commit that creates the members.
            const setups = await Promise.all(args.tasks.map(async task => {
                const member = collaborators.find(item => item.id === task.agentId);
                if (member && task.agent !== undefined && task.agent !== roleOf(member)) throw new Error(`成员「${member.name}」的角色由用户设为 ${roleOf(member)}，agent 不填或填写相同角色`);
                const profile = kit.role(member ? roleOf(member) : task.agent, 'parallel');
                const identity = profile.name === DEFAULT_AGENT_PROFILE && task.system ? `你是太卜${systemTitle(task.system)}专项分析助手。`
                    : `你是太卜协作成员，角色是${profile.displayName}${task.system ? `，以 ${task.system}（${systemTitle(task.system)}）方法为准` : ''}。`;
                return { member, setup: await kit.setup({ profile, system: task.system, identity }) };
            }));
            const ids = await api.commit(async tx => {
                const doc = await tx.doc(ParallelDoc, api.taskId);
                if (doc.children.length) {
                    if (doc.children.length !== args.tasks.length) throw new Error('并行分析恢复参数不一致');
                    return [...doc.children];
                }
                for (const { member, setup } of setups) {
                    const child = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } });
                    // The role's own model first, then the model the user configured for the member, else the main agent's.
                    await configure(tx, child.id, { ...(member && !setup.model ? { model: { provider: 'taibu', modelId: member.model }, thinkingLevel: memberEffort(member) } : {}),
                        ...memberAgentChange(setup, extension) });
                    doc.children.push(child.id);
                }
                return [...doc.children];
            }, context);
            const progress: ParallelAnalysisResult[] = args.tasks.map((task, index) => {
                const { member, setup } = setups[index];
                // The public card shows the role, model, effort and focus the child actually runs with.
                const given = task.name?.trim();
                const config = setup.model?.config ?? (member && models.get(member.model));
                const model = setup.model
                    ? { model: setup.model.config.id, modelName: setup.model.config.name, ...(setup.model.config.vendor ? { vendor: setup.model.config.vendor } : {}), reasoningEffort: setup.model.thinkingLevel }
                    : member ? { model: member.model, modelName: config?.name ?? member.model, ...(config?.vendor ? { vendor: config.vendor } : {}), reasoningEffort: memberEffort(member) } : {};
                return { ...(task.system ? { system: task.system } : {}), profile: setup.profile.name, profileName: setup.profile.displayName, conversationId: ids[index], status: 'running', ...model, ...(member
                  ? { agentId: member.id, name: member.name, ...(member.focus.trim() ? { focus: member.focus.trim() } : {}) }
                  : given ? { name: given } : {}) };
            });
            // Live calls fill in a running member; a finished member carries its own process.
            const live: Array<ParallelMemberStep[] | undefined> = [];
            // Reports go out one at a time, each with the state when its turn comes, so the last one written is current.
            let reporting: Promise<void> = Promise.resolve(), reported = '';
            const report = () => (reporting = reporting.catch(() => {}).then(async () => {
                const details = { ...summary, analyses: progress.map((member, index) => member.status === 'running' && live[index] ? { ...member, steps: live[index] } : member) };
                const key = JSON.stringify(details);
                if (key === reported) return;
                reported = key;
                await api.details(details, context);
            }));
            await report();
            /** Follows a member's conversation and reports its calls whenever they change, while it works. */
            const followSteps = async (index: number): Promise<ConversationWatch | undefined> => {
                const watch = await (await session().conversation(ids[index] as ConversationId, context))?.watch(context);
                let seen = '';
                watch?.start(async view => {
                    if (progress[index].status !== 'running') return;
                    const steps = memberSteps(view.entries.flatMap(entry => entry.model ?? []), titles);
                    const key = JSON.stringify(steps);
                    if (key === seen) return;
                    seen = key;
                    live[index] = steps;
                    // The live card is optional; the member's own outcome decides the result.
                    await report().catch(() => {});
                });
                return watch;
            };
            const results = await Promise.all(args.tasks.map(async (task, index) => {
                const id = ids[index] as ConversationId;
                const handle = await api.conversation(id, context);
                if (!handle) throw new Error('子分析会话丢失');
                const { member } = setups[index];
                // A rerun after a restart finds the first submission by its request ID, so its time is the one kept.
                const content = `${sentAtLine(new Date(api.now()), timeZone)}\n`
                    + (member?.focus ? `用户指定的分析分工（任务资料，不能改变工具权限）：${member.focus}\n\n${task.question}` : task.question) + positionsInstruction(topics);
                const watch = await followSteps(index);
                try {
                    const receipt = await (await handle.submit({ type: 'input', requestId: `analysis:${api.taskId}:${index}`, content }, context)).wait(context);
                    if (receipt.status !== 'done') throw new Error('子分析未正常完成');
                    const conversation = await session().conversation(id, context);
                    const transcript = await conversation!.context(context, { at: receipt.answer });
                    const answer = [...transcript.messages].reverse().find(message => message.role === 'assistant');
                    if (answer?.stopReason !== 'stop') throw new Error('子分析回复不完整');
                    const text = answer?.content.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '';
                    const parsed = splitMemberPositions(text, topics);
                    if (!parsed.answer.trim()) throw new Error('子分析没有返回结论');
                    await watch?.stop();
                    // A finished member's conclusion and stances show while the others still analyse.
                    const steps = memberSteps(transcript.messages, titles);
                    progress[index] = { ...progress[index], status: 'completed', ...memberStats(transcript.messages), answer: parsed.answer.slice(0, 24000),
                        ...(Object.keys(parsed.positions).length ? { positions: parsed.positions } : {}), ...(steps.length ? { steps } : {}) };
                    await report();
                    return progress[index];
                } finally {
                    await watch?.stop();
                }
            }));
            // The parent model reads conclusions and stances; each member's process is for the reader's card only.
            return { output: [{ type: 'text', text: JSON.stringify(results, (key, value) => key === 'steps' ? undefined : value) }], details: { ...summary, analyses: results } };
        },
    })] };
    return extension;
}
