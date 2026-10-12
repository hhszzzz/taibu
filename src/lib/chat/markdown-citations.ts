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

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };
/** Literal text whose brackets are not markers: code, links, definitions, raw HTML and footnotes. */
const SKIPPED = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition', 'html', 'image', 'imageReference', 'footnoteReference', 'footnoteDefinition']);

function replaceCitations(node: MdNode, isKnown: (cite: number) => boolean) {
    if (!node.children || SKIPPED.has(node.type)) return;
    node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) {
            replaceCitations(child, isKnown);
            return [child];
        }
        const pieces = splitCitations(child.value, isKnown);
        if (pieces.length === 1 && typeof pieces[0] === 'string') return [child];
        // Rendered as <sup data-cite="n">n</sup>; the renderer turns it into a badge.
        return pieces.map(piece => typeof piece === 'string' ? { type: 'text', value: piece }
            : { type: 'citation', data: { hName: 'sup', hProperties: { dataCite: piece.cite }, hChildren: [{ type: 'text', value: String(piece.cite) }] } });
    });
}

/** Remark plugin: known citation markers become `sup[data-cite]` elements. */
export function remarkCitations(options: { isKnown: (cite: number) => boolean }) {
    return (tree: unknown) => { replaceCitations(tree as MdNode, options.isKnown); };
}

const parser = unified().use(remarkParse).use(remarkGfm);
const UNCOUNTED = new Set(['heading', 'thematicBreak', 'code', 'html', 'definition', 'footnoteDefinition']);

function collectCitations(node: MdNode, isKnown: (cite: number) => boolean, found: number[]) {
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
