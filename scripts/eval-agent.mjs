import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import { randomBytes } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.cwd() !== root) throw new Error('Run eval:agent from the repository root');
const require = createRequire(import.meta.url);
require('./ts-register.cjs');
const { row, config: fixtureConfig, MemoryStore, scripted } = require('../src/tests/helpers/agent-runtime-fixture.ts');
const { executeAgentRun } = require('../src/lib/agent/runtime.server.ts');
const { assertAgentEvaluation, judgeAgentEvaluation } = require('../src/lib/agent/evaluation.server.ts');
const { AGENT_TOOL_SEARCH_TOOL, getAgentDrilldownBase, isAgentDeferredTool } = require('../src/lib/agent/tool-catalog.ts');
const cases = JSON.parse(await readFile(path.join(root, 'scripts/evals/agent-cases.json'), 'utf8'));
const credits = require('../src/lib/user/credits.ts'), features = require('../src/lib/app-settings.ts');
mock.method(credits, 'getUserCreditInfo', async () => ({ membership: 'plus', credits: 10, expiresAt: null }));
mock.method(features, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' }));
const argv = process.argv.slice(2), live = argv.includes('--live');
const vision = argv.includes('--vision');
const argument = name => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1]; };
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
        config = { ...model, requiredTier: 'free', supportsVision: !!model.supportsVision, gatewayId, apiKeySecret, sources: [source] };
    }
    const { createPiModelStream } = require('../src/lib/agent/pi-stream.server.ts');
    let visionBytes;
    if (vision) {
        if (!live || !config.supportsVision) throw new Error('--vision requires --live and a vision-enabled private model configuration');
        visionBytes = await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="white"/><circle cx="150" cy="150" r="75" fill="#ff0000"/><rect x="375" y="75" width="150" height="150" fill="#0000ff"/></svg>')).png().toBuffer();
        cases.splice(0, cases.length, { id: 'vision-basic', guide: 'vision', visual: true, prompt: '请读取所附图片，按从左到右列出每个图形的形状和颜色，并给出图形总数。只描述图片，不调用占术工具。', assertions: ['从左到右是红色圆形、蓝色正方形', '图形总数为两个', '依据实际图片，不猜测或声称无法看到图片'] });
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
        const run = row(), store = new MemoryStore();
        run.input.model = config.id; run.input.title = item.id;
        run.input.userMessage.content = item.prompt;
        run.checkpoint.messages[0].content = item.prompt;
        // 质量评测依据：排盘成果与详查结果都提供规范文本。
        const coreTexts = () => [...store.drafts.values()].filter(artifact => artifact.kind === 'calculation' || getAgentDrilldownBase(artifact.tool_name)).map(artifact => artifact.result.canonicalText);
        // This private configuration represents an administrator platform model.
        const streamFn = live ? createPiModelStream(config, { reasoning: false, ...(item.visual ? { resolveImages: async messages => {
            const lastUser = messages.findLastIndex(message => message.role === 'user');
            return messages.map((message, index) => index === lastUser ? { role: 'user', content: [{ type: 'text', text: typeof message.content === 'string' ? message.content : item.prompt }, { type: 'image', image: visionBytes, mediaType: 'image/png' }] } : message);
        } } : {}) }) : scripted(index => {
            // 详查用例先排盘，再用成果引用调用详查工具；低频工具与真实模型一样先经 tool_search 加载。
            const steps = [
                { id: 'guide', name: 'load_analysis_method', arguments: () => ({ id: item.guide }) },
                ...(item.chart ? [{ id: 'chart', name: item.chart.tool, arguments: () => item.chart.arguments }] : []),
                ...(isAgentDeferredTool(item.tool) ? [{ id: 'search', name: AGENT_TOOL_SEARCH_TOOL, arguments: () => ({ query: item.tool }) }] : []),
                { id: 'compute', name: item.tool, arguments: () => {
                    if (!item.chart) return item.arguments;
                    const chart = [...store.drafts.values()].find(artifact => artifact.tool_name === item.chart.tool);
                    if (!chart) throw new Error('未找到 ' + item.chart.tool + ' 的成果，无法详查');
                    return { reference: 'artifact:' + chart.id, ...item.arguments };
                } },
            ];
            if (index < steps.length) return [{ type: 'toolCall', id: steps[index].id, name: steps[index].name, arguments: steps[index].arguments() }];
            return [{ type: 'text', text: '根据实际 Core 盘面给出结论。离线模式只检查结构，不评价解读质量。' }];
        });
        let stage = 'execution', judgeResponse, judgeStatus, guideLoaded = false;
        try {
            await executeAgentRun(store, run, AbortSignal.timeout(300000), { config, streamFn });
            const finished = store.writes.findLast(write => write.name === 'agent_finish_run');
            if (finished?.args.p_status !== 'completed') throw new Error('任务未完成');
            stage = 'core-integrity';
            if (item.visual) {
                const answer = finished.args.p_message.content;
                if (!/红|red/i.test(answer) || !/圆|circle/i.test(answer) || !/蓝|blue/i.test(answer) || !/方|square/i.test(answer) || !/两个|两种|2|two/i.test(answer) || answer.search(/红|red/i) > answer.search(/蓝|blue/i)) throw new Error('视觉推理与图片不一致');
            } else await assertAgentEvaluation(run, item.tool, [...store.drafts.values()], store);
            stage = 'guide-loading';
            guideLoaded = store.nativeEntries().some(entry => entry.model?.some(message => message.role === 'toolResult' && message.toolName === 'load_analysis_method' && !message.isError));
            if (!live && !guideLoaded) throw new Error('未加载体系方法卡');
            let quality;
            if (live) {
                stage = 'quality-judge';
                console.log(`STRUCTURE ${item.id}: Core consistent; guide=${guideLoaded}`);
                const input = { question: item.prompt, assertions: item.assertions, answer: finished.args.p_message.content, core:     coreTexts() };
                report.cases.push({ id: item.id, guide: item.guide, tool: item.tool, structural: true, guideLoaded, quality: null, qualityPending: true, passed: false, usage: finished.args.p_checkpoint.runtime?.usage, answer: input.answer, core: input.core });
                await saveReport(); report.cases.pop();
                const evaluated = await judgeAgentEvaluation(config, input);
                quality = evaluated.quality; judgeResponse = evaluated.judgeResponse; judgeStatus = evaluated.judgeStatus;
            }
            const pass = !quality || quality.passed;
            report.cases.push({ id: item.id, guide: item.guide, tool: item.tool, structural: true, guideLoaded, quality: quality ?? null, passed: pass, usage: finished.args.p_checkpoint.runtime?.usage, ...(live ? { answer: finished.args.p_message.content, core:     coreTexts() } : {}) });
            console.log(`${pass ? 'PASS' : 'FAIL'} ${item.id} (${item.tool})${live ? ' structure + model quality judge' : ' structure only'}`);
        } catch (error) {
            const finish = store.writes.findLast(write => write.name === 'agent_finish_run');
            const called = [...new Set(store.nativeEntries().flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult').map(message => message.toolName))];
            const diagnostic = { name: error?.name, ...(Number.isInteger(error?.statusCode) ? { statusCode: error.statusCode } : {}), ...((error?.judgeStatus ?? judgeStatus) ? { judgeStatus: error?.judgeStatus ?? judgeStatus } : {}) };
            const requested = [...new Set(store.nativeEntries().flatMap(entry => entry.model ?? []).filter(message => message.role === 'assistant').flatMap(message => message.content.filter(part => part.type === 'toolCall').map(part => part.name)))];
            report.cases.push({ id: item.id, guide: item.guide, tool: item.tool, structural: ['guide-loading', 'quality-judge'].includes(stage), guideLoaded, passed: false, failedStage: stage, status: finish?.args.p_status, called, requested, error: finish?.args.p_message?.agent?.error, diagnostic, ...(live ? { answer: finish?.args.p_message?.content, judgeResponse: error?.judgeResponse ?? judgeResponse, core:     coreTexts() } : {}) });
            console.log(`FAIL ${item.id} (${stage}; status=${finish?.args.p_status}; tools=${called.join(',')})`);
        }
        await saveReport();
    }
    if (!report.cases.length) throw new Error('No evaluation cases selected');
    await saveReport();
    console.log(`${report.cases.filter(item => item.passed).length}/${report.cases.length} passed; ${new Set(report.cases.map(item => item.guide)).size} systems`);
    if (report.cases.some(item => !item.passed)) process.exitCode = 1;
} finally {
    mock.restoreAll();
}
