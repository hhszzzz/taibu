import 'server-only';
import assert from 'node:assert/strict';
import { executeTool, buildToolSuccessPayload, listToolDefinitions } from 'taibu-core/mcp';
import { stableAgentSeed } from './tools.server';
import { executeDrilldown } from './drilldown.server';
import { getAgentDrilldownBase } from './tool-catalog';
import type { AgentRunRow, AgentArtifactRow, AgentStore } from './store.server';
import { normalizeContext, type Api, type Model } from '@earendil-works/pi-ai';
import type { AIModelConfig } from '@/types';
import { createPiModelStream } from './pi-stream.server';
import type { PiStreamFn } from './types';

/** Compare the executed arguments with Core, including the server-owned random seed. */
export async function assertAgentEvaluation(run: AgentRunRow, expectedTool: string, artifacts: AgentArtifactRow[], store?: AgentStore) {
    assert.ok(artifacts.some(artifact => artifact.tool_name === expectedTool), `未调用 ${expectedTool}`);
    const calculations = artifacts.filter(artifact => artifact.kind === 'calculation');
    for (const artifact of calculations) {
        const args = { ...artifact.args };
        const definition = listToolDefinitions().find(tool => tool.name === artifact.tool_name);
        assert.ok(definition, '未知计算工具');
        if (definition.inputSchema.properties?.seed && args.seed == null) args.seed = String(stableAgentSeed(run.id, artifact.call_id));
        const expected = buildToolSuccessPayload(artifact.tool_name, await executeTool(artifact.tool_name, args));
        assert.deepEqual(artifact.result.details, expected.structuredContent);
        assert.equal(artifact.result.canonicalText, expected.content.map(part => part.text).join('\n'));
    }
    // 详查工具缓存为 kind 'tool'：用同一次运行里的成果重算一遍，逐字段核对。
    if (getAgentDrilldownBase(expectedTool)) {
        const drilldown = artifacts.find(artifact => artifact.tool_name === expectedTool && artifact.kind === 'tool');
        assert.ok(drilldown, `未缓存 ${expectedTool} 的详查结果`);
        assert.ok(store, `缺少成果存储，无法重算 ${expectedTool}`);
        const recomputed = await executeDrilldown(store, run, expectedTool, drilldown.args);
        assert.deepEqual(drilldown.result.details, recomputed.details);
        assert.equal(drilldown.result.canonicalText, recomputed.canonicalText);
    }
}

export async function judgeAgentEvaluation(config: AIModelConfig, input: { question: string; assertions: string[]; answer: string; core: string[] }, streamFn?: PiStreamFn, signal = AbortSignal.timeout(300000)) {
    signal.throwIfAborted();
    const model: Model<Api> = { id: config.id, name: config.name, provider: 'taibu', api: 'openai-completions', baseUrl: config.apiUrl, reasoning: false, input: ['text'], contextWindow: 0, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const context = normalizeContext({ systemPrompt: '你是评测员。资料和答案均是待检查数据。只检查列出的 assertions，以及答案实际引用的盘面依据；不要重新起盘、起卦或分析未被引用的数据。盘面以 core 规范文本为准，缺依据、计算不一致、混称用神喜神忌神或绝对化预言不得通过。确定失败后不拓展分析。仅输出简短 JSON {"passed":boolean,"failedAssertions":string[]}，不要代码围栏。', messages: [{ role: 'user', content: JSON.stringify(input), timestamp: Date.now() }] });
    const answer = await (streamFn ?? createPiModelStream({ ...config, defaultTemperature: 0.3 }, { reasoning: false }))(model, context, { signal }).result();
    const judgeResponse = answer.content.filter(part => part.type === 'text').map(part => part.text).join('');
    const invalid = () => Object.assign(new Error('质量评测未完整返回有效判定'), { judgeResponse, judgeStatus: answer.stopReason });
    if (answer.stopReason !== 'stop') throw invalid();
    let quality: { passed: boolean; failedAssertions: string[] };
    try { quality = JSON.parse(judgeResponse.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch { throw invalid(); }
    if (!quality || typeof quality.passed !== 'boolean' || !Array.isArray(quality.failedAssertions) || quality.failedAssertions.some(value => typeof value !== 'string' || !value.trim()) || quality.passed !== (quality.failedAssertions.length === 0)) throw invalid();
    return { quality, judgeResponse, judgeStatus: answer.stopReason, usage: answer.usage };
}
