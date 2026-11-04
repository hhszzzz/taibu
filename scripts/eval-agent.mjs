import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.cwd() !== root) throw new Error('Run eval:agent from the repository root');
const require = createRequire(import.meta.url);
require('./ts-register.cjs');
const { config: fixtureConfig, scripted } = require('../src/tests/helpers/agent-runtime-fixture.ts');
const { runAgentEvalCase } = require('../src/lib/agent/eval/runner.server.ts');
const { judgeAgentEvaluation } = require('../src/lib/agent/evaluation.server.ts');
const { AGENT_SKILL_TOOLS, AGENT_TOOL_SEARCH_TOOL, isAgentDeferredTool } = require('../src/lib/agent/tool-catalog.ts');
const { CHARTLESS_EVAL_TOOL } = require('../src/lib/agent/eval/types.ts');
const cases = JSON.parse(await readFile(path.join(root, 'scripts/evals/agent-cases.json'), 'utf8'));
const argv = process.argv.slice(2), live = argv.includes('--live');
const vision = argv.includes('--vision');
const argument = name => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1]; };
/** A live model writes long readings; --timeout raises the per-case cap. */
const runTimeoutMs = Number(argument('--timeout')) || 900000;
/** The judge reads the whole chart as evidence, so it gets its own ten minutes. */
const judgeTimeoutMs = Number(argument('--judge-timeout')) || 600000;
// The CLI evaluates the way the admin runner does: no database mocks, fixed switches.
const featureState = async () => ({ status: 'enabled' });
let config = fixtureConfig;
try {
    if (live) {
        const file = argument('--config');
        if (!file) throw new Error('Live evaluation requires --config <private AIModelConfig JSON path>');
        const { apiKey, ...model } = JSON.parse(await readFile(file, 'utf8'));
        if (!model.id || !model.modelId || !model.vendor || !model.apiUrl || !apiKey) throw new Error('Live model config is incomplete');
        // The key is sealed the way a gateway's saved key is, so the run opens it on the worker's own path.
        process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
        const { sealGatewayApiKey } = require('../src/lib/ai/gateway-secrets.server.ts');
        const gatewayId = 'eval-gateway', { secret: apiKeySecret } = sealGatewayApiKey(gatewayId, apiKey);
        const source = { sourceKey: 'eval', sourceName: 'eval', gatewayId, apiKeySecret, apiUrl: model.apiUrl, modelIdOverride: model.modelId, priority: 0, isEnabled: true, isActive: true };
        config = { ...model, supportsVision: !!model.supportsVision, gatewayId, apiKeySecret, sources: [source] };
    }
    const { createPiModelStream } = require('../src/lib/agent/pi-stream.server.ts');
    let visionBytes;
    if (vision) {
        if (!live || !config.supportsVision) throw new Error('--vision requires --live and a vision-enabled private model configuration');
        visionBytes = await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="white"/><circle cx="150" cy="150" r="75" fill="#ff0000"/><rect x="375" y="75" width="150" height="150" fill="#0000ff"/></svg>')).png().toBuffer();
        cases.splice(0, cases.length, { id: 'vision-basic', guide: 'vision', visual: true, tool: 'vision', arguments: {}, prompt: '请读取所附图片，按从左到右列出每个图形的形状和颜色，并给出图形总数。只描述图片，不调用占术工具。', assertions: ['从左到右是红色圆形、蓝色正方形', '图形总数为两个', '依据实际图片，不猜测或声称无法看到图片'] });
    }
    const report = { mode: live ? 'live' : 'offline', model: config.id, timestamp: new Date().toISOString(), cases: [] };
    const previous = argument('--resume') ? JSON.parse(await readFile(argument('--resume'), 'utf8')) : undefined;
    if (previous && (!live || previous.mode !== 'live' || previous.model !== config.id || !Array.isArray(previous.cases))) throw new Error('--resume requires a live report for the same model');
    const saved = new Map((previous?.cases ?? []).map(item => [item.id, item]));
    if (previous) report.resumedFrom = previous.timestamp;
    const out = argument('--output');
    const saveReport = async () => { if (out) { const target = path.resolve(out), temporary = `${target}.tmp`; await mkdir(path.dirname(target), { recursive: true }); await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, target); } };
    for (const item of cases.filter(item => !argument('--case') || item.id === argument('--case'))) {
        const cached = saved.get(item.id);
        if (live && cached?.structural && typeof cached.answer === 'string' && Array.isArray(cached.core) && cached.core.every(value => typeof value === 'string')) {
            // A completed negative judgment remains negative. Resume retries
            // unfinished scores against exactly the saved answer and Core data.
            if (cached.quality && typeof cached.quality.passed === 'boolean') report.cases.push(cached);
            else {
                console.log(`REJUDGE ${item.id}`);
                const previousDiagnostic = cached.diagnostic;
                try {
                    const score = await judgeAgentEvaluation(config, { question: item.prompt, assertions: item.assertions, answer: cached.answer, core: cached.core });
                    report.cases.push({ ...cached, quality: score.quality, qualityUsage: score.usage, passed: score.quality.passed, qualityPending: undefined, failedStage: undefined, diagnostic: undefined, judgeResponse: undefined, reusedExecution: true, previousDiagnostic });
                } catch (error) {
                    report.cases.push({ ...cached, qualityPending: undefined, passed: false, failedStage: 'quality-judge', diagnostic: { name: error?.name, judgeStatus: error?.judgeStatus }, judgeResponse: error?.judgeResponse, reusedExecution: true, previousDiagnostic });
                }
            }
            await saveReport(); console.log(`${report.cases.at(-1).passed ? 'PASS' : 'FAIL'} ${item.id} (saved execution)`); continue;
        }
        console.log(`START ${item.id}`);
        // 详查用例先排盘，再用成果引用调用详查工具；低频工具与真实模型一样先经 tool_search 加载。
        const createStream = live
            ? (item.visual ? ({ config: modelConfig, telemetry }) => createPiModelStream(modelConfig, { reasoning: false, telemetry, resolveImages: async messages => {
                const lastUser = messages.findLastIndex(message => message.role === 'user');
                return messages.map((message, index) => index === lastUser ? { role: 'user', content: [{ type: 'text', text: typeof message.content === 'string' ? message.content : item.prompt }, { type: 'image', image: visionBytes, mediaType: 'image/png' }] } : message);
            } }) : undefined)
            : ({ store }) => scripted(index => {
                const steps = [
                    { id: 'guide', name: AGENT_SKILL_TOOLS.load, arguments: () => ({ name: item.guide }) },
                    ...(item.chart ? [{ id: 'chart', name: item.chart.tool, arguments: () => item.chart.arguments }] : []),
                    ...(item.tool !== CHARTLESS_EVAL_TOOL && isAgentDeferredTool(item.tool) ? [{ id: 'search', name: AGENT_TOOL_SEARCH_TOOL, arguments: () => ({ query: item.tool }) }] : []),
                    ...(item.tool === CHARTLESS_EVAL_TOOL ? [] : [{ id: 'compute', name: item.tool, arguments: () => {
                        if (!item.chart) return item.arguments;
                        const chart = [...store.drafts.values()].find(artifact => artifact.tool_name === item.chart.tool);
                        if (!chart) throw new Error('未找到 ' + item.chart.tool + ' 的成果，无法详查');
                        return { reference: 'artifact:' + chart.id, ...item.arguments };
                    } }]),
                ];
                if (index < steps.length) return [{ type: 'toolCall', id: steps[index].id, name: steps[index].name, arguments: steps[index].arguments() }];
                return [{ type: 'text', text: '根据实际 Core 盘面给出结论。离线模式只检查结构，不评价解读质量。' }];
            });
        const outcome = await runAgentEvalCase({
            evalId: report.timestamp,
            case: item,
            config,
            createStream,
            featureState,
            // A stalled provider still fails instead of hanging the sweep; live readings simply get longer.
            signal: AbortSignal.timeout(runTimeoutMs),
            ...(live ? { judge: { config, signal: AbortSignal.timeout(judgeTimeoutMs) } } : {}),
        });
        const visionFailure = item.visual && !(/红|red/i.test(outcome.answer) && /圆|circle/i.test(outcome.answer)
            && /蓝|blue/i.test(outcome.answer) && /方|square/i.test(outcome.answer) && /两个|两种|2|two/i.test(outcome.answer)
            && outcome.answer.search(/红|red/i) <= outcome.answer.search(/蓝|blue/i));
        const guideFailure = !live && outcome.hardPassed && !outcome.guideLoaded;
        // A card that tells the model to ask first (推理时柱) parks the task by design; there is no reading to judge.
        if (outcome.askedUser && outcome.hardPassed) {
            report.cases.push({
                id: item.id, guide: item.guide, tool: item.tool, structural: true, guideLoaded: outcome.guideLoaded,
                quality: null, passed: true, askedUser: true, usage: outcome.usage,
                ...(live ? { answer: outcome.answer, core: outcome.core } : {}),
            });
            console.log(`PASS ${item.id} (asked the user, as its card requires)`);
        } else if (outcome.hardPassed && !guideFailure && !visionFailure && (live ? !outcome.judgeError : true)) {
            const quality = outcome.quality ?? null;
            report.cases.push({
                id: item.id, guide: item.guide, tool: item.tool, structural: true, guideLoaded: outcome.guideLoaded,
                quality: quality ?? null, passed: live ? quality?.passed === true : true, usage: outcome.usage,
                ...(outcome.judgeResponse ? { judgeResponse: outcome.judgeResponse } : {}),
                ...(live ? { answer: outcome.answer, core: outcome.core } : {}),
            });
            console.log(`${report.cases.at(-1).passed ? 'PASS' : 'FAIL'} ${item.id} (${item.tool})${live ? ' structure + model quality judge' : ' structure only'}`);
        } else {
            const stage = visionFailure ? 'core-integrity' : guideFailure ? 'guide-loading' : outcome.stage;
            report.cases.push({
                id: item.id, guide: item.guide, tool: item.tool,
                structural: stage === 'guide-loading' || stage === 'quality-judge',
                guideLoaded: outcome.guideLoaded, passed: false, failedStage: stage,
                status: outcome.status, called: outcome.calledTools, requested: outcome.requestedTools,
                ...(visionFailure ? { error: '视觉推理与图片不一致' } : outcome.error || outcome.judgeError ? { error: outcome.error ?? outcome.judgeError } : {}),
                diagnostic: outcome.diagnostic ?? {},
                ...(live ? { answer: outcome.answer, judgeResponse: outcome.judgeResponse, core: outcome.core } : {}),
            });
            console.log(`FAIL ${item.id} (${stage}; status=${outcome.status}; tools=${outcome.calledTools.join(',')})`);
        }
        await saveReport();
    }
    if (!report.cases.length) throw new Error('No evaluation cases selected');
    await saveReport();
    console.log(`${report.cases.filter(item => item.passed).length}/${report.cases.length} passed; ${new Set(report.cases.map(item => item.guide)).size} systems`);
    if (report.cases.some(item => !item.passed)) process.exitCode = 1;
} finally {
    // The runner owns no global mocks; nothing to restore.
}
