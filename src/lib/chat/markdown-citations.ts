import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

/**
 * Citation markers in answers: `[1]`, `[1, 2]`, `[1][2]` or full-width `【1、2】`.
 * A group counts only when every number in it is known, so prose that merely
 * looks like a marker, or a number the model invented, stays plain text.
 */
const CITATION_GROUP = /\[(\d{1,4}(?:[ \t]*[,，、][ \t]*\d{1,4})*)\]|【(\d{1,4}(?:[ \t]*[,，、][ \t]*\d{1,4})*)】/gu;

export type CitationPiece = string | { cite: number };

export function splitCitations(text: string, isKnown: (cite: number) => boolean): CitationPiece[] {
    const pieces: CitationPiece[] = [];
    let start = 0;
    for (const match of text.matchAll(CITATION_GROUP)) {
        const numbers = (match[1] ?? match[2]).split(/[,，、]/u).map(value => Number(value.trim()));
        if (!numbers.every(isKnown)) continue;
        if (match.index > start) pieces.push(text.slice(start, match.index));
        pieces.push(...numbers.map(cite => ({ cite })));
        start = match.index + match[0].length;
    }
    if (start < text.length) pieces.push(text.slice(start));
    return pieces;
}

type MdNode = { type: string; value?: string; label?: string; children?: MdNode[]; data?: Record<string, unknown> };
/** Literal text whose brackets are not markers: code, links, definitions, raw HTML and footnotes. */
const SKIPPED = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition', 'html', 'image', 'imageReference', 'footnoteReference', 'footnoteDefinition']);
const NUMERIC_GROUP = /^\d{1,4}(?:[ \t]*[,，、][ \t]*\d{1,4})*$/u;
const NUMERIC_LABEL = /^\d{1,4}$/u;

const citationNode = (cite: number): MdNode => ({ type: 'citation', data: { hName: 'sup', hProperties: { dataCite: cite }, hChildren: [{ type: 'text', value: String(cite) }] } });

/**
 * `[2][3]` is a Markdown reference link (text "2", label "3") whenever a `[3]: …` definition is
 * present, so the answer's adjacent citations would otherwise lose their numbers to link parsing.
 * Numeric text and label together are the citation group the model wrote; both count.
 */
function referenceCitations(node: MdNode, isKnown: (cite: number) => boolean): number[] | null {
    if (node.type !== 'linkReference') return null;
    const text = node.children?.length === 1 && node.children[0].type === 'text' ? node.children[0].value?.trim() ?? '' : '';
    const label = node.label?.trim() ?? '';
    if (!NUMERIC_GROUP.test(text) || !NUMERIC_LABEL.test(label)) return null;
    const numbers = [...new Set([...text.split(/[,，、]/u).map(value => Number(value.trim())), Number(label)])];
    return numbers.every(isKnown) ? numbers : null;
}

function replaceCitations(node: MdNode, isKnown: (cite: number) => boolean) {
    if (!node.children || SKIPPED.has(node.type)) return;
    node.children = node.children.flatMap(child => {
        const references = referenceCitations(child, isKnown);
        if (references) return references.map(citationNode);
        if (child.type !== 'text' || !child.value) {
            replaceCitations(child, isKnown);
            return [child];
        }
        const pieces = splitCitations(child.value, isKnown);
        if (pieces.length === 1 && typeof pieces[0] === 'string') return [child];
        // Rendered as <sup data-cite="n">n</sup>; the renderer turns it into a badge.
        return pieces.map(piece => typeof piece === 'string' ? { type: 'text', value: piece } : citationNode(piece.cite));
    });
}

/** Remark plugin: known citation markers become `sup[data-cite]` elements. */
export function remarkCitations(options: { isKnown: (cite: number) => boolean }) {
    return (tree: unknown) => { replaceCitations(tree as MdNode, options.isKnown); };
}

const parser = unified().use(remarkParse).use(remarkGfm);
const UNCOUNTED = new Set(['heading', 'thematicBreak', 'code', 'html', 'definition', 'footnoteDefinition']);

function collectCitations(node: MdNode, isKnown: (cite: number) => boolean, found: number[]) {
    const references = referenceCitations(node, isKnown);
    if (references) { found.push(...references); return; }
    if (SKIPPED.has(node.type)) return;
    if (node.type === 'text' && node.value) {
        for (const piece of splitCitations(node.value, isKnown)) if (typeof piece !== 'string') found.push(piece.cite);
        return;
    }
    node.children?.forEach(child => collectCitations(child, isKnown, found));
}

/**
 * The paragraph that first cites each number, counted from 1 among an answer's
 * prose blocks (paragraphs, lists, quotes, tables); headings and code are not paragraphs.
 */
export function getCitedParagraphs(markdown: string, isKnown: (cite: number) => boolean): Map<number, number> {
    const paragraphs = new Map<number, number>();
    if (!markdown.trim()) return paragraphs;
    let index = 0;
    for (const block of (parser.parse(markdown) as MdNode).children ?? []) {
        if (UNCOUNTED.has(block.type)) continue;
        index++;
        const found: number[] = [];
        collectCitations(block, isKnown, found);
        for (const cite of found) if (!paragraphs.has(cite)) paragraphs.set(cite, index);
    }
    return paragraphs;
}
