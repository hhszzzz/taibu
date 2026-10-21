import 'server-only';

import { Parser } from 'saxen';

/**
 * Word body text, read from the document part as a stream of XML events. A DOM of a few megabytes of dense
 * WordprocessingML takes gigabytes, so nothing here holds more than the text it has collected.
 *
 * The text is what a reader of the document sees, in the way mammoth reads it: paragraphs, tabs and breaks,
 * inserted text and text boxes; not formatting properties, deleted text or field codes. Alternate content is read
 * from its fallback, which repeats what the choice shows.
 */

/** The package relationships, which name the body part. */
export const WORD_RELATIONSHIPS_PART = '_rels/.rels';
/** Where Word and nearly every other writer put the body. */
const DEFAULT_DOCUMENT_PART = 'word/document.xml';
/** Elements whose content is never shown as text. Property elements (`pPr`, `rPr`, `sectPr`…) are hidden by name. */
const HIDDEN = new Set(['del', 'delText', 'delInstrText', 'instrText', 'moveFrom', 'Choice', 'footnoteRef', 'endnoteRef']);
const PROPERTIES = /Pr(?:Ex)?$/u;
/** How many elements are read between checks of the caller's signal. */
const SIGNAL_INTERVAL = 4096;

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

/** The body part the package relationships name, as a path inside the archive. */
export function wordDocumentPartName(relationships: Uint8Array | undefined): string {
    if (!relationships) return DEFAULT_DOCUMENT_PART;
    let target = DEFAULT_DOCUMENT_PART;
    const parser = new Parser();
    parser.on('openTag', (name, attrs, decode) => {
        if (localName(name) !== 'Relationship') return;
        const values = attrs();
        if (!values || !/\/officeDocument$/u.test(decode(values.Type ?? '')) || !values.Target) return;
        // Targets are relative to the package root, written with or without a leading "/" or "./".
        target = decode(values.Target).replace(/^\.?\//u, '');
        parser.stop();
    });
    parser.parse(new TextDecoder().decode(relationships));
    return target;
}

/** The text of a document part; malformed XML throws. */
export function wordBodyText(xml: string, signal?: AbortSignal): string {
    const parser = new Parser();
    const pieces: string[] = [];
    // Depth inside hidden elements, and inside text elements (w:t, and m:t / a:t in equations and drawings).
    let hidden = 0;
    let text = 0;
    let elements = 0;
    parser.on('openTag', name => {
        if (++elements % SIGNAL_INTERVAL === 0 && signal?.aborted) parser.stop();
        const local = localName(name);
        if (hidden || HIDDEN.has(local) || PROPERTIES.test(local)) {
            hidden += 1;
            return;
        }
        if (local === 't') text += 1;
        else if (local === 'tab' || local === 'ptab') pieces.push('\t');
        else if (local === 'br' || local === 'cr') pieces.push('\n');
        else if (local === 'noBreakHyphen') pieces.push('-');
    });
    // Self-closing elements also close, so the depths stay balanced.
    parser.on('closeTag', name => {
        if (hidden) {
            hidden -= 1;
            return;
        }
        const local = localName(name);
        if (local === 't') text -= 1;
        else if (local === 'p') pieces.push('\n\n');
    });
    parser.on('text', (value, decode) => {
        if (text && !hidden) pieces.push(decode(value));
    });
    parser.on('cdata', value => {
        if (text && !hidden) pieces.push(value);
    });
    parser.parse(xml);
    signal?.throwIfAborted();
    // Empty paragraphs space a page out; in text one blank line between paragraphs is enough.
    return pieces.join('').replace(/\n{3,}/gu, '\n\n');
}
