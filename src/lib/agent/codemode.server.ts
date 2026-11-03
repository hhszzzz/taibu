import 'server-only';
import { obj, opt, str, unknown } from '@earendil-works/pi-schema';
import { CodemodeSandbox, toCodemodeIdentifier, type CodemodeRunOptions, type CodemodeWasmModule } from '@earendil-works/pi-codemode';
import { CODEMODE_TOOL_NAME, createCodemodeTool } from '@earendil-works/pi-durable/codemode';
import type { Extension, PromptSection } from '@earendil-works/pi-durable';

/** A script's whole run, its tool calls included; the script's own `timeout_ms` may only shorten it. */
export const AGENT_CODEMODE_TIMEOUT_MS = 120_000;
/** Calls one script may make. Each tool call is a durable task with its own commits, so a loop cannot flood the log. */
export const AGENT_CODEMODE_CALL_LIMIT = 30;
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
/** QuickJS VMs one worker process runs at once, across all of its tasks. */
const MAX_VMS = 4;

class AgentCodemodeSandbox extends CodemodeSandbox {
  // Pi starts a script without a deadline unless the script asks for one.
  override start(code: string, options: CodemodeRunOptions) {
    return super.start(code, { ...options, timeoutMs: Math.min(options.timeoutMs ?? AGENT_CODEMODE_TIMEOUT_MS, AGENT_CODEMODE_TIMEOUT_MS) });
  }
}

let bundled: { wasm: CodemodeWasmModule; workerUrl: URL } | undefined;
let sandbox: AgentCodemodeSandbox | undefined;
let vms = 0;

/**
 * The bundled worker ships the VM worker and the QuickJS binary beside itself (build-agent-worker.mjs); unbundled
 * code, such as tests, uses the files of the installed packages.
 */
export function configureAgentCodemode(assets: { wasm: CodemodeWasmModule; workerUrl: URL }) {
  bundled = assets;
  sandbox = undefined;
}

/** A script runs in a fresh VM of the configured sandbox: the worker file and the QuickJS binary load and execute. */
export async function checkAgentCodemode() {
  const result = await new CodemodeSandbox({ memoryLimitBytes: MEMORY_LIMIT_BYTES, ...bundled }).execute('return 1 + 1', { timeoutMs: 10_000 });
  if (!result.ok || result.value !== 2) throw new Error(`Code mode sandbox check failed: ${result.ok ? 'unexpected result' : result.error.message}`);
}

function agentCodemodeSandbox() {
  sandbox ??= new AgentCodemodeSandbox({
    memoryLimitBytes: MEMORY_LIMIT_BYTES,
    ...bundled,
    acquireWorker: () => {
      if (vms >= MAX_VMS) throw new Error('代码模式正忙，请稍后再运行脚本');
      vms++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        vms--;
      };
    },
  });
  return sandbox;
}

/** What charts, calculations and drilldowns give scripts, instead of only their text. */
export const AGENT_SCRIPT_RESULT_SCHEMA = obj({
  artifactId: opt(str()),
  text: str(),
  data: unknown(),
}, { open: true });

export function agentScriptResult(output: { content: Array<{ text: string }>; details: unknown; canonicalText?: string }) {
  const details = output.details && typeof output.details === 'object' ? output.details as { artifactId?: unknown; result?: unknown } : {};
  return {
    ...(typeof details.artifactId === 'string' ? { artifactId: details.artifactId } : {}),
    text: output.canonicalText ?? output.content.map(part => part.text).join('\n'),
    data: details.result ?? null,
  };
}

/**
 * The position of a script's call among the calls it made: Pi names a script's tool call `<codemode call>/c<n>`, `n`
 * counting every call the script made, in order and the same after a restart. Undefined for any other call.
 */
export function agentScriptCallNumber(callId: string): number | undefined {
  const match = /\/c([1-9]\d*)$/u.exec(callId);
  return match ? Number(match[1]) : undefined;
}

const codemodeSection: PromptSection = {
  key: 'taibu_codemode',
  render: input => {
    // Members of a parallel analysis keep the extension but are not offered the tool.
    if (!input.agent.tools.some(tool => tool.name === CODEMODE_TOOL_NAME)) return undefined;
    const callable = input.agent.callable.map(tool => toCodemodeIdentifier(tool.name));
    if (!callable.length) return undefined;
    return [
      '本任务开启了代码模式。需要批量排盘、逐年逐月扫描、比较多组出生时间或参数、筛选择日时，用 codemode 写一段 JavaScript 调用工具，只输出汇总后的结论，减少来回调用；单次简单调用仍直接调用工具。',
      '脚本中 await tools.<名称>(参数) 的参数与直接调用相同。排盘、计算与详查返回 { artifactId?, text, data }：text 是规范文本，data 是 Core 规范 JSON（中文键，不确定结构时先打印键名再取值），排盘的 artifactId 与直接排盘一样可写作 artifact:<artifactId> 交给查看与详查。其他工具返回文本。',
      `脚本可调用本任务全部工具（包括需 tool_search 加载的低频工具）：${callable.join(', ')}。`,
      `提问、查看与定位盘面、联网与知识库检索、长期记忆、加载方法、查找工具和协作分析只能直接调用。单个脚本最多发起 ${AGENT_CODEMODE_CALL_LIMIT} 次调用、运行不超过 ${AGENT_CODEMODE_TIMEOUT_MS / 1000} 秒，不要打印整张盘；脚本输出是给你的资料，向用户解读时仍以工具结果为准。`,
    ].join('\n');
  },
};

/** The code mode tool and its guidance. Scripts call the task's own tools as nested calls; models stay off. */
export function createAgentCodemodeExtension(): Extension {
  const tool = createCodemodeTool({ sandbox: agentCodemodeSandbox(), models: false });
  // Pi lets a script print megabytes for coding agents; a reading needs a summary, bounded like any other result.
  return { name: 'taibu_codemode', tools: [{ ...tool, outputLimits: undefined }], sections: [codemodeSection] };
}
