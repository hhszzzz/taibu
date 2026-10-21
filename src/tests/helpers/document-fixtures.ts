import { crc32, deflateRawSync } from 'node:zlib';

/** Builds documents byte by byte, so parser tests need no binary fixtures in the repository. */

export interface ZipEntryFixture {
    name: string;
    content: string | Uint8Array;
    /** Defaults to deflated, as Office writes its parts. */
    stored?: boolean;
    /** Marks the entry encrypted without encrypting it. */
    encrypted?: boolean;
    /** Points the entry at an earlier entry's data instead of its own, as overlapping zip bombs do; content is ignored. */
    sameDataAs?: string;
}

export function zipArchive(entries: readonly ZipEntryFixture[]): Uint8Array<ArrayBuffer> {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    const written = new Map<string, Buffer>();
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        if (entry.sameDataAs !== undefined) {
            const shared = written.get(entry.sameDataAs);
            if (!shared) throw new Error(`zip fixture: no earlier entry ${entry.sameDataAs}`);
            const central = Buffer.from(shared.subarray(0, 46));
            central.writeUInt16LE(name.length, 28);
            centrals.push(Buffer.concat([central, name]));
            continue;
        }
        const content = typeof entry.content === 'string' ? Buffer.from(entry.content) : Buffer.from(entry.content);
        const data = entry.stored ? content : deflateRawSync(content);
        const flags = 0x0800 | (entry.encrypted ? 0x0001 : 0);
        const method = entry.stored ? 0 : 8;
        const local = Buffer.alloc(30 + name.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc32(content), 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(content.length, 22);
        local.writeUInt16LE(name.length, 26);
        name.copy(local, 30);
        const central = Buffer.alloc(46 + name.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(flags, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(crc32(content), 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(content.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        name.copy(central, 46);
        locals.push(local, data);
        centrals.push(central);
        written.set(entry.name, central);
        offset += local.length + data.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const escapeXml = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>';

/** A Word document part with this body. */
export const wordDocumentXml = (body: string) => '<?xml version="1.0" encoding="UTF-8"?><w:document'
    + ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
    + `<w:body>${body}</w:body></w:document>`;

/**
 * A Word package holding `documentXml` in `part` (word/document.xml by default), which its relationships name
 * as `target` (the part path by default).
 */
export function docxPackage(
    documentXml: string | Uint8Array,
    options: { part?: string; target?: string; extra?: readonly ZipEntryFixture[] } = {},
): Uint8Array<ArrayBuffer> {
    const part = options.part ?? 'word/document.xml';
    return zipArchive([
        { name: '[Content_Types].xml', content: CONTENT_TYPES },
        { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${options.target ?? part}"/></Relationships>` },
        { name: part, content: documentXml },
        ...(options.extra ?? []),
    ]);
}

/** A Word document with one paragraph per string, plus any extra parts. */
export function docxDocument(paragraphs: readonly string[], extra: readonly ZipEntryFixture[] = []): Uint8Array<ArrayBuffer> {
    const body = paragraphs.map(text => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join('');
    return docxPackage(wordDocumentXml(body), { extra });
}

export type CellFixture = string | number | boolean | { date: number } | null;

/** A workbook whose sheets hold the given rows; `{ date }` is an Excel serial day shown with a date format. */
export function xlsxWorkbook(sheets: ReadonlyArray<{ name: string; rows: readonly (readonly CellFixture[])[] }>): Uint8Array<ArrayBuffer> {
    const strings: string[] = [];
    const column = (index: number) => String.fromCharCode(65 + index);
    const cell = (value: CellFixture, reference: string) => {
        if (value === null) return '';
        if (typeof value === 'string') {
            strings.push(value);
            return `<c r="${reference}" t="s"><v>${strings.length - 1}</v></c>`;
        }
        if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
        if (typeof value === 'number') return `<c r="${reference}"><v>${value}</v></c>`;
        return `<c r="${reference}" s="1"><v>${value.date}</v></c>`;
    };
    const sheetParts = sheets.map((sheet, index) => ({
        name: `xl/worksheets/sheet${index + 1}.xml`,
        content: '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            + sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cell(value, `${column(columnIndex)}${rowIndex + 1}`)).join('')}</row>`).join('')
            + '</sheetData></worksheet>',
    }));
    const relationship = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
    return zipArchive([
        { name: '[Content_Types].xml', content: CONTENT_TYPES },
        { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship('rId1', 'officeDocument', 'xl/workbook.xml')}</Relationships>` },
        { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            + sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('') + '</sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + sheets.map((_, index) => relationship(`rId${index + 1}`, 'worksheet', `worksheets/sheet${index + 1}.xml`)).join('')
            + relationship('rIdStrings', 'sharedStrings', 'sharedStrings.xml') + relationship('rIdStyles', 'styles', 'styles.xml') + '</Relationships>' },
        ...sheetParts,
        { name: 'xl/sharedStrings.xml', content: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(text => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('')}</sst>` },
        { name: 'xl/styles.xml', content: '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>' },
    ]);
}

/** A PDF with one page per content stream, all sharing font F1. */
export function pdfDocument(pageContents: readonly string[], font: readonly string[]): Uint8Array<ArrayBuffer> {
    const pageCount = pageContents.length;
    const fontObject = 3 + pageCount * 2;
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Kids [${pageContents.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`,
        ...pageContents.flatMap((content, index) => [
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
            `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
        ]),
        ...font.map(body => body.replaceAll('{next}', String(fontObject + 1)).replaceAll('{after}', String(fontObject + 2))),
    ];
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, index) => {
        offsets.push(Buffer.byteLength(out, 'latin1'));
        out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(out, 'latin1'));
}

export const HELVETICA = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];

/** A non-embedded Chinese font whose codes only the predefined UniGB-UCS2-H CMap can decode. */
export const SONG_UCS2 = [
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [{next} 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor {after} 0 R >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',
];

/** Text drawn in F1; with SONG_UCS2, pass UCS-2 hex such as `<4F60597D>`. */
export const showText = (operand: string) => `BT /F1 12 Tf 20 100 Td ${operand} Tj ET`;
