/**
 * 不调用上游时的 token 估算：按模型的 tokenizer 家族，给拉丁词、数字串、汉字、标点、换行等分别加权。
 *
 * 移植自 new-api 的 tokenkit（https://github.com/QuantumNous/new-api/tree/main/tokenkit，AGPL-3.0），
 * 家族划分、版本解析与权重保持一致，同一段文本与网关本地估算的结果相同。权重用 Claude Code / Codex 的真实会话
 * 对照上游 usage 校准；未识别的模型（如 DeepSeek）沿用旧 OpenAI 权重，未校准。超过 64 字符的连续字母或数字按
 * 子词计，避免把无分隔的长串算成一个词。
 * 真实计数走网关的 count_tokens（见 src/lib/agent/token-count.server.ts），这里是它不可用时的退路，以及旧任务没有
 * 计数时的展示。
 */

export type TokenFamily = 'openai' | 'claude' | 'claude4.7' | 'gemini' | 'unknown';

/** 按模型名归入 tokenizer 家族；不区分大小写，允许厂商前缀与日期后缀。 */
export function tokenFamily(model: string): TokenFamily {
    const name = model.toLowerCase();
    if (name.includes('gemini')) return 'gemini';
    if (name.includes('claude')) return claudeUsesOpus47Tokenizer(name) ? 'claude4.7' : 'claude';
    if (['gpt-', 'o1', 'o3', 'o4', 'chatgpt'].some(marker => name.includes(marker))) return 'openai';
    return 'unknown';
}

/** Claude Opus 4.7 起换了 tokenizer；读不出版本号的名字按新的算。 */
function claudeUsesOpus47Tokenizer(model: string) {
    const version = modelVersion(model, 'claude-');
    if (!version) return true;
    const [major, minor] = version;
    return major > 4 || (major === 4 && minor >= 7);
}

/** 前缀之后的头一两个一到两位数版本号（claude-opus-4-7、claude-3-5-sonnet）；日期这类长数字结束版本号。 */
function modelVersion(model: string, prefix: string): [number, number] | null {
    const at = model.indexOf(prefix);
    if (at < 0) return null;
    const version: number[] = [];
    for (const part of model.slice(at + prefix.length).split(/[-.]/u).filter(Boolean)) {
        const digits = /^\d*/u.exec(part)![0].length;
        if (digits === 0 || digits > 2) {
            if (version.length) break;
            continue;
        }
        version.push(Number(part.slice(0, digits)));
        if (version.length === 2 || digits < part.length) break;
    }
    return version.length ? [version[0], version[1] ?? 0] : null;
}

interface Weights { word: number; number: number; cjk: number; symbol: number; mathSymbol: number; urlDelim: number; atSign: number; emoji: number; newline: number; space: number }

const WEIGHTS: Record<TokenFamily, Weights> = {
    gemini: { word: 0.89, number: 2.42, cjk: 0.93, symbol: 0.65, mathSymbol: 1.05, urlDelim: 1.3, atSign: 2.5, emoji: 1.08, newline: 1.28, space: 0 },
    claude: { word: 1.24, number: 1.53, cjk: 1.38, symbol: 0.66, mathSymbol: 4.52, urlDelim: 0.74, atSign: 2.82, emoji: 2.6, newline: 1.19, space: 0.14 },
    'claude4.7': { word: 1.52, number: 1.77, cjk: 1.4, symbol: 0.89, mathSymbol: 4.52, urlDelim: 1.45, atSign: 2.82, emoji: 2.6, newline: 1.38, space: 0.21 },
    openai: { word: 0.75, number: 1.86, cjk: 0.96, symbol: 0.6, mathSymbol: 2.68, urlDelim: 0.77, atSign: 2.0, emoji: 2.12, newline: 0.95, space: 0.17 },
    unknown: { word: 1.02, number: 1.55, cjk: 0.85, symbol: 0.4, mathSymbol: 2.68, urlDelim: 1.0, atSign: 2.0, emoji: 2.12, newline: 0.5, space: 0.42 },
};

const SPACE = /\p{White_Space}/u;
const HAN = /\p{Script=Han}/u;
const LETTER = /\p{L}/u;
const NUMBER = /\p{N}/u;
const MATH_SYMBOLS = new Set('∑∫∂√∞≤≥≠≈±×÷∈∉∋∌⊂⊃⊆⊇∪∩∧∨¬∀∃∄∅∆∇∝∟∠∡∢°′″‴⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎²³¹⁴⁵⁶⁷⁸⁹⁰');
const URL_DELIMS = new Set('/:?&=;#%');

const isCjk = (char: string, code: number) => HAN.test(char) || (code >= 0x3040 && code <= 0x30ff) || (code >= 0xac00 && code <= 0xd7a3);
const isEmoji = (code: number) => (code >= 0x1f300 && code <= 0x1f9ff) || (code >= 0x2600 && code <= 0x26ff) || (code >= 0x2700 && code <= 0x27bf) || (code >= 0x1fa00 && code <= 0x1faff);
const isMathSymbol = (char: string, code: number) => MATH_SYMBOLS.has(char) || (code >= 0x2200 && code <= 0x22ff) || (code >= 0x2a00 && code <= 0x2aff) || (code >= 0x1d400 && code <= 0x1d7ff);

/** How much of the text fits the budget, and where it ends: a code-unit offset, never inside a surrogate pair. */
type Scan = { tokens: number; end: number };

/** A run longer than any word is prose or a key; real tokenizers split it into subwords, so it cannot stay one token. */
const LONG_RUN_CHARS = 64;
const WORD_CHAR_SHARE = 1 / 4;
const NUMBER_CHAR_SHARE = 1 / 3;

/** One pass over the text; stop before the character that would take the count past `maxTokens`. */
function scanTokens(text: string, weight: Weights, maxTokens = Infinity): Scan {
    let count = 0, end = 0;
    // 连续的字母算一个词、连续的数字算一串；字母与数字交替时各起一段。
    let run: 'none' | 'word' | 'number' = 'none';
    let runChars = 0;
    for (const char of text) {
        const code = char.codePointAt(0)!;
        let added: number;
        if (SPACE.test(char)) {
            run = 'none';
            added = char === '\n' || char === '\t' ? weight.newline : weight.space;
        } else if (isCjk(char, code)) {
            run = 'none';
            added = weight.cjk;
        } else if (isEmoji(code)) {
            run = 'none';
            added = weight.emoji;
        } else if (LETTER.test(char) || NUMBER.test(char)) {
            const next = NUMBER.test(char) ? 'number' : 'word';
            if (run === next) {
                runChars += 1;
                added = runChars > LONG_RUN_CHARS ? next === 'number' ? NUMBER_CHAR_SHARE : WORD_CHAR_SHARE : 0;
            } else {
                added = next === 'number' ? weight.number : weight.word;
                run = next;
                runChars = 1;
            }
        } else {
            run = 'none';
            added = isMathSymbol(char, code) ? weight.mathSymbol : char === '@' ? weight.atSign : URL_DELIMS.has(char) ? weight.urlDelim : weight.symbol;
        }
        if (Math.ceil(count + added) > maxTokens) break;
        count += added;
        end += char.length;
    }
    return { tokens: Math.ceil(count), end };
}

/** 估算一段文本在某个模型下的 token 数（向上取整）。 */
export function estimateTokens(model: string, text: string): number {
    return text ? scanTokens(text, WEIGHTS[tokenFamily(model)]).tokens : 0;
}

const TRUNCATION_MARKER = '...（内容已截断）';

/** The text cut to at most `maxTokens`, marked when something was removed. */
export function truncateToTokens(model: string, text: string, maxTokens: number): string {
    if (!text) return text;
    if (maxTokens <= 0) return TRUNCATION_MARKER;
    const scan = scanTokens(text, WEIGHTS[tokenFamily(model)], maxTokens);
    return scan.end === text.length ? text : `${text.slice(0, scan.end)}${TRUNCATION_MARKER}`;
}

/** The text of each message, summed; a message without text adds nothing. */
export function estimateMessageTokens(model: string, messages: readonly { content?: string }[]): number {
    let total = 0;
    for (const message of messages) if (message?.content) total += estimateTokens(model, String(message.content));
    return total;
}
