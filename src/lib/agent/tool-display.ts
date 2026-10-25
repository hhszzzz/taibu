/**
 * 步骤展开后的展示文本：调用参数排成一条命令行、原始结果排成带缩进的 JSON，都切成带类别的片段，
 * 由界面按命令行配色着色；复制时把片段原样拼回去。规范文本里的「- 键: 值」行加粗键名，
 * 界面据此把它们排成键值两列。这里只改排版，不改任何取值。
 */

export type DisplayTokenKind = 'prompt' | 'command' | 'flag' | 'string' | 'number' | 'literal' | 'punct' | 'key' | 'text';
export interface DisplayToken { kind: DisplayTokenKind; text: string }

/** 一行放不下这么多字符时，每个参数单独一行，行尾接续符 `\`。 */
const SINGLE_LINE_LIMIT = 72;
const INDENT = '    ';

/** 嵌套参数按路径展开：a.name、tasks[0].question。 */
function flatten(value: unknown, path: string, into: Array<[string, unknown]>) {
    if (Array.isArray(value)) {
        // 全是标量的数组写成一个逗号分隔的值；含对象的数组逐项展开。
        if (value.every(item => item === null || typeof item !== 'object')) { into.push([path, value]); return; }
        value.forEach((item, index) => flatten(item, `${path}[${index}]`, into));
        return;
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        // 空对象在顶层就是「没有参数」；嵌套的空对象照写。
        if (!entries.length) { if (path) into.push([path, value]); return; }
        for (const [key, item] of entries) flatten(item, path ? `${path}.${key}` : key, into);
        return;
    }
    into.push([path, value]);
}

/** 双引号括起的字符串值；换行保持原样，便于读多行文本。 */
const quote = (text: string) => `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;

function valueToken(value: unknown): DisplayToken {
    if (typeof value === 'string') return { kind: 'string', text: quote(value) };
    if (typeof value === 'number' || typeof value === 'bigint') return { kind: 'number', text: String(value) };
    if (Array.isArray(value)) return { kind: 'string', text: quote(value.map(item => item === null ? 'null' : String(item)).join(',')) };
    if (value !== null && typeof value === 'object') return { kind: 'literal', text: '{}' };
    return { kind: 'literal', text: String(value) };
}

/** `$ bazi --gender "male" --birthYear 1990`：工具名是命令，参数是选项；参数多时逐行排开。 */
export function toolCommandTokens(name: string, input: unknown): DisplayToken[] {
    const flags: Array<[string, unknown]> = [];
    if (input !== undefined && input !== null && typeof input === 'object') flatten(input, '', flags);
    else if (input !== undefined) flags.push(['input', input]);
    const pairs = flags.map(([key, value]) => [{ kind: 'flag', text: `--${key}` }, valueToken(value)] as const);
    const length = name.length + pairs.reduce((sum, [flag, value]) => sum + flag.text.length + value.text.length + 2, 2);
    const multiline = pairs.length > 2 || length > SINGLE_LINE_LIMIT || pairs.some(([, value]) => value.text.includes('\n'));
    const tokens: DisplayToken[] = [{ kind: 'prompt', text: '$ ' }, { kind: 'command', text: name }];
    for (const [flag, value] of pairs) {
        tokens.push(multiline ? { kind: 'punct', text: ` \\\n${INDENT}` } : { kind: 'text', text: ' ' });
        tokens.push(flag, { kind: 'text', text: ' ' }, value);
    }
    return tokens;
}

/** 缩进两格的 JSON：键、字符串、数字、字面量各成一类片段。 */
export function jsonTokens(value: unknown): DisplayToken[] {
    const tokens: DisplayToken[] = [];
    const push = (kind: DisplayTokenKind, text: string) => tokens.push({ kind, text });
    const walk = (item: unknown, depth: number) => {
        const pad = '  '.repeat(depth + 1), close = '  '.repeat(depth);
        if (Array.isArray(item)) {
            if (!item.length) { push('punct', '[]'); return; }
            push('punct', '[\n');
            item.forEach((entry, index) => { push('text', pad); walk(entry, depth + 1); push('punct', index < item.length - 1 ? ',\n' : '\n'); });
            push('punct', `${close}]`);
            return;
        }
        if (item !== null && typeof item === 'object') {
            const entries = Object.entries(item as Record<string, unknown>).filter(([, entry]) => entry !== undefined);
            if (!entries.length) { push('punct', '{}'); return; }
            push('punct', '{\n');
            entries.forEach(([key, entry], index) => {
                push('text', pad); push('key', JSON.stringify(key)); push('punct', ': ');
                walk(entry, depth + 1);
                push('punct', index < entries.length - 1 ? ',\n' : '\n');
            });
            push('punct', `${close}}`);
            return;
        }
        if (typeof item === 'string') push('string', JSON.stringify(item));
        else if (typeof item === 'number') push('number', Number.isFinite(item) ? String(item) : 'null');
        else push('literal', item === undefined ? 'null' : String(item));
    };
    walk(value, 0);
    return tokens;
}

export const joinTokens = (tokens: readonly DisplayToken[]) => tokens.map(token => token.text).join('');

/**
 * 「- 姓名: 演示命盘」→「- **姓名** 演示命盘」：只动列表项开头 12 字以内、不含冒号的键。半角冒号后必须有空格，
 * 免得把网址、钟点（09:00）拆开；全角冒号后可以直接接值。
 */
const KEY_VALUE_LINE = /^(\s*[-*+]\s+)([^\s:：*`|\[][^:：*`|\n]{0,11}?)\s*(?::\s+|：\s*)(\S.*)$/u;

export function formatStepMarkdown(text: string): string {
    let fenced = false;
    return text.split('\n').map(line => {
        if (/^\s*(```|~~~)/u.test(line)) fenced = !fenced;
        if (fenced) return line;
        const match = KEY_VALUE_LINE.exec(line);
        return match ? `${match[1]}**${match[2].trim()}** ${match[3]}` : line;
    }).join('\n');
}
