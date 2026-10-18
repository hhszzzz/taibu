/**
 * 实际请求模型 ID → 供应商 的前缀匹配（纯函数，测试安全）。
 *
 * 自定义模型面板用它给用户即时显示匹配到的厂商图标：
 * - `deepseek-chat` → deepseek
 * - `anthropic/claude-sonnet-4-5` → anthropic（按 `/` 分段匹配）
 * - 未命中任何前缀时返回 null，界面回退到通用图标。
 */
import type { KnownAIVendor } from '@/types';

const VENDOR_PREFIXES: ReadonlyArray<readonly [KnownAIVendor, RegExp]> = [
    ['anthropic', /^(claude|anthropic)/],
    ['openai', /^(gpt|chatgpt|o1|o3|o4|codex|davinci|text-embedding)/],
    ['gemini', /^(gemini|gemma|palm|bison)/],
    ['deepseek', /^deepseek/],
    ['glm', /^(glm|zhipu|chatglm)/],
    ['qwen', /^(qwen|qwq|qvq)/],
    ['moonshot', /^(kimi|moonshot)/],
    ['xai', /^(grok|xai)/],
    ['minimax', /^(minimax|abab)/],
];

/**
 * 按模型 ID 前缀匹配供应商。
 *
 * 整串与每个 `/` 分段都会尝试；`openrouter/anthropic/claude-…` 这类
 * 带网关前缀的写法按分段命中 anthropic。
 */
export function matchModelVendor(modelId: string): KnownAIVendor | null {
    const id = modelId.trim().toLowerCase();
    if (!id) return null;
    const candidates = [id, ...id.split('/')];
    for (const [vendor, pattern] of VENDOR_PREFIXES) {
        if (candidates.some((part) => pattern.test(part))) {
            return vendor;
        }
    }
    return null;
}
