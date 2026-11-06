import { unified, type PluggableList } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';

type Node = { type?: string; value?: string; children?: Node[] };

/**
 * `<br>` 是模型在表格单元格里唯一可用的换行写法；转成 mdast break，避免放开任意 HTML。
 */
function remarkBreakTags() {
    const brTag = /^<br\s*\/?>$/iu;
    const walk = (node: Node) => {
        if (!node.children) return;
        node.children = node.children.map(child => {
            if (child.type === 'html' && typeof child.value === 'string' && brTag.test(child.value.trim())) {
                return { type: 'break' };
            }
            walk(child);
            return child;
        });
    };
    return (tree: Node) => walk(tree);
}

/**
 * CommonMark 不把贴着中文标点的 `*`/`**`/`~~` 当强调（`**「…」**三张盘`、`**…（…）**`），
 * 模型几乎天天这么写；这两个扩展按 CJK 规范放宽 flanking 判定，不改非 CJK 文本。
 */
export const markdownPlugins: PluggableList = [remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough, remarkBreakTags];
const parser = unified().use(remarkParse).use(remarkGfm);
function needsDocument(node: Node): boolean {
    return node.type === 'definition' || node.type === 'footnoteDefinition' || node.type === 'html'
        || Boolean(node.children?.some(needsDocument));
}

/**
 * 中文模型常把 Markdown 标记与内容贴在一起（`##标题`、`1.内容`、`-列表项`、`1、内容`），
 * 这些在 CommonMark 里都不成块。渲染前按行补一个空格，围栏代码块内原样保留。
 */
export function normalizeMarkdownMarkers(source: string): string {
    if (!/[#\d•·-]/u.test(source)) return source;
    let fence: { marker: string; length: number } | null = null;
    return source.split('\n').map(line => {
        const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
        if (match) {
            if (!fence) fence = { marker: match[1][0], length: match[1].length };
            else if (match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = null;
            return line;
        }
        if (fence) return line;
        return line
            .replace(/^(\s{0,3})(#{1,6})(?=[^\s#])/u, '$1$2 ')
            .replace(/^(\s{0,3})(\d{1,9})\.(?=[^\s\d])/u, '$1$2. ')
            .replace(/^(\s{0,3})(\d{1,9})、\s*/u, '$1$2. ')
            .replace(/^(\s{0,3})-(?=[^\s\d-])/u, '$1- ')
            .replace(/^(\s{0,3})[•·]\s*/u, '$1- ');
    }).join('\n');
}

/** Same GFM grammar as the renderer; source slices retain indentation and CRLF. */
export function splitMarkdown(source: string): { blocks: string[]; document: boolean } {
    if (!source) return { blocks: [], document: false };
    const tree = parser.parse(source);
    if (needsDocument(tree)) return { blocks: [source], document: true };
    const boundaries = tree.children.slice(1).map(node => node.position?.start.offset);
    if (boundaries.some(offset => offset === undefined)) return { blocks: [source], document: true };
    let start = 0;
    const blocks = boundaries.map(offset => {
        const end = source.lastIndexOf('\n', offset! - 1) + 1;
        const block = source.slice(start, end);
        start = end;
        return block;
    });
    blocks.push(source.slice(start));
    return { blocks, document: false };
}

export function pendingChartFence(source: string): boolean {
    // CommonMark closes a fence only with the same character and at least its opening length.
    const lines = source.split(/\r?\n/u);
    let fence: { marker: string; length: number; chart: boolean } | null = null;
    for (const line of lines) {
        const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
        if (!match) continue;
        if (!fence) fence = { marker: match[1][0], length: match[1].length, chart: /^chart(?:\s|$)/u.test(match[2].trim()) };
        else if (match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = null;
    }
    return fence?.chart ?? false;
}

export class MarkdownBlocks {
    private source = '';
    private blocks: string[] = [];
    private document = false;
    advance(source: string): string[] {
        const normalized = normalizeMarkdownMarkers(source);
        if (normalized === this.source) return this.blocks;
        const append = this.blocks.length > 0 && normalized.startsWith(this.source);
        if (append && this.document) this.blocks = [normalized];
        else {
            const stable = append ? this.blocks.slice(0, -1) : [];
            const tail = normalized.slice(stable.reduce((total, block) => total + block.length, 0));
            const parsed = splitMarkdown(tail);
            this.document = parsed.document;
            this.blocks = parsed.document ? [normalized] : [...stable, ...parsed.blocks];
            // Bound memoized elements in unusually fragmented messages.
            if (this.blocks.length > 512) this.blocks = [this.blocks.slice(0, -128).join(''), ...this.blocks.slice(-128)];
        }
        this.source = normalized;
        return this.blocks;
    }
}

export function tableCsv(rows: string[][]): string {
    return '\ufeff' + rows.map(row => row.map(cell => {
        const safe = /^[\s]*[=+@-]/u.test(cell) ? `'${cell}` : cell;
        return `"${safe.replaceAll('"', '""')}"`;
    }).join(',')).join('\r\n');
}
