import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
    DOCUMENT_ACCEPT,
    DOCUMENT_FORMATS,
    MAX_DOCUMENT_BYTES,
    MAX_DOCUMENT_TEXT_BYTES,
    documentFormatOf,
    documentRejection,
    isChatAttachment,
} from '../lib/ai/document-formats';
import {
    DOCUMENT_PARSERS,
    DocumentTextError,
    PDF_CMAP_DIRECTORY,
    PDF_MAX_PAGES,
    createDocumentTextExtractor,
    documentTextErrorStatus,
    extractDocumentText,
    formatSheet,
    type DocumentParser,
} from '../lib/ai/document-text.server';
import { readZipArchive, writeStoredZip, ZipArchiveError } from '../lib/ai/document-zip.server';
import { HELVETICA, SONG_UCS2, docxDocument, docxPackage, pdfDocument, showText, wordDocumentXml, xlsxWorkbook, zipArchive } from './helpers/document-fixtures';

const utf8 = (text: string) => new TextEncoder().encode(text);
const extract = (name: string, bytes: Uint8Array) => extractDocumentText({ name, bytes });
async function rejection(promise: Promise<unknown>): Promise<DocumentTextError> {
    try {
        await promise;
    } catch (error) {
        assert.ok(error instanceof DocumentTextError, `expected DocumentTextError, got ${String(error)}`);
        return error;
    }
    assert.fail('expected the document to be refused');
}

test('every offered format has a parser, and pickers offer exactly the catalog', () => {
    for (const format of DOCUMENT_FORMATS) assert.equal(typeof DOCUMENT_PARSERS[format.parser], 'function', format.extension);
    assert.deepEqual(DOCUMENT_ACCEPT.split(','), DOCUMENT_FORMATS.map(format => `.${format.extension}`));
    assert.equal(documentFormatOf(' 命书.PDF ')?.parser, 'pdf');
    assert.equal(documentFormatOf('archive.tar.gz'), null);
    assert.equal(documentRejection('报告.docx'), null);
    assert.match(documentRejection('a.exe') ?? '', /^不支持该文件类型，可上传 PDF、Word、Excel、TXT、Markdown/u);
    assert.match(documentRejection('old.DOC') ?? '', /另存为 \.docx/u);
    assert.match(documentRejection('old.xls') ?? '', /另存为 \.xlsx/u);
    assert.match(documentRejection('x.constructor') ?? '', /^不支持该文件类型/u, 'object keys are not formats');
});

test('a request carries a document as a bounded name and non-empty text', () => {
    assert.equal(isChatAttachment({ name: '命书.pdf', text: '正文' }), true);
    for (const value of [null, [], 'text', { name: '', text: '正文' }, { name: 'a.txt', text: '  ' }, { name: 'a'.repeat(201), text: '正文' }, { name: 'a.txt', text: 1 }]) {
        assert.equal(isChatAttachment(value), false, JSON.stringify(value));
    }
    assert.equal(isChatAttachment({ name: 'a.txt', text: '字'.repeat(Math.floor(MAX_DOCUMENT_TEXT_BYTES / 3) + 1) }), false, 'limited in UTF-8 bytes');
});

test('text documents are decoded as UTF-8 with line endings and a byte-order mark normalized', async () => {
    const document = await extract('  笔记.md  ', utf8(String.fromCharCode(0xfeff) + '# 标题\r\n正文\r第二行\n'));
    assert.deepEqual({ name: document.name, text: document.text, parser: document.format.parser }, { name: '笔记.md', text: '# 标题\n正文\n第二行', parser: 'text' });
    const long = (await extract(`${'名'.repeat(300)}.txt`, utf8('x'))).name;
    assert.equal(long.length, 200);
    assert.ok(long.endsWith('名.txt'), 'the extension survives shortening');
});

test('unreadable, empty and oversized documents are refused with a reason and status', async () => {
    const cases: Array<[string, Uint8Array, string, number]> = [
        ['a.exe', utf8('x'), 'UNSUPPORTED_FORMAT', 415],
        ['a.txt', new Uint8Array(), 'EMPTY_FILE', 400],
        ['a.txt', new Uint8Array(MAX_DOCUMENT_BYTES + 1).fill(0x61), 'FILE_TOO_LARGE', 413],
        ['a.txt', new Uint8Array([0xff, 0xfe, 0x00]), 'UNREADABLE', 422],
        ['a.txt', utf8('a\u0000b'), 'UNREADABLE', 422],
        ['a.txt', utf8(' \r\n\t'), 'NO_TEXT', 422],
        ['a.txt', utf8('字'.repeat(Math.floor(MAX_DOCUMENT_TEXT_BYTES / 3) + 1)), 'TEXT_TOO_LARGE', 413],
    ];
    for (const [name, bytes, code, status] of cases) {
        const error = await rejection(extract(name, bytes));
        assert.equal(error.code, code, name);
        assert.equal(documentTextErrorStatus(error), status, code);
    }
});

test('a parser that overruns the deadline is cut off, and a caller abort is not reported as a timeout', async () => {
    const hang: DocumentParser = () => new Promise(() => undefined);
    const slow = createDocumentTextExtractor({ text: hang }, 20);
    assert.equal((await rejection(slow({ name: 'a.txt', bytes: utf8('x') }))).code, 'TIMEOUT');
    const caller = new AbortController();
    const pending = slow({ name: 'a.txt', bytes: utf8('x') }, caller.signal);
    caller.abort(new Error('client left'));
    await assert.rejects(pending, /client left/u);
});

test('a parser crash reaches the user as an unreadable file of that format', async t => {
    t.mock.method(console, 'warn', () => undefined);
    const crash = createDocumentTextExtractor({ pdf: async () => { throw new TypeError('bad xref'); } });
    const error = await rejection(crash({ name: 'a.pdf', bytes: utf8('%PDF') }));
    assert.equal(error.code, 'UNREADABLE');
    assert.match(error.message, /^PDF 文件无法读取/u);
    assert.equal((await rejection(createDocumentTextExtractor({})({ name: 'a.pdf', bytes: utf8('%PDF') }))).code, 'UNSUPPORTED_FORMAT', 'a missing parser');
});

test('PDF text includes CJK fonts that need the predefined CMaps', async () => {
    assert.ok(existsSync(`${PDF_CMAP_DIRECTORY}UniGB-UCS2-H.bcmap`), 'pdfjs-dist CMaps are installed where pdf.js reads them');
    assert.equal((await extract('a.pdf', pdfDocument([showText('(Hello PDF)')], HELVETICA))).text, 'Hello PDF');
    assert.equal((await extract('命书.pdf', pdfDocument([showText('<4F60597D>'), showText('<4E16754C>')], SONG_UCS2))).text, '你好\n\n世界');
});

test('PDFs without a text layer, with too many pages or broken bytes are refused', async t => {
    t.mock.method(console, 'warn', () => undefined);
    const blank = await rejection(extract('scan.pdf', pdfDocument(['0 0 m 10 10 l S'], HELVETICA)));
    assert.equal(blank.code, 'NO_TEXT');
    assert.match(blank.message, /扫描件/u);
    const long = await rejection(extract('long.pdf', pdfDocument(Array.from({ length: PDF_MAX_PAGES + 1 }, () => showText('(x)')), HELVETICA)));
    assert.equal(long.code, 'TEXT_TOO_LARGE');
    assert.equal((await rejection(extract('broken.pdf', utf8('%PDF-1.4 not really')))).code, 'UNREADABLE');
});

test('Word text is read from the body alone; media and other parts are never inflated', async () => {
    const unread = [
        { name: 'word/media/image1.png', content: new Uint8Array(40 * 1024 * 1024) },
        { name: 'word/footnotes.xml', content: new Uint8Array(33 * 1024 * 1024).fill(0x20) },
    ];
    const document = await extract('报告.docx', docxDocument(['第一段 & 符号', '第二段'], unread));
    assert.equal(document.text, '第一段 & 符号\n\n第二段');
});

test('Word text keeps what a reader sees and leaves out properties, deletions, field codes and duplicate alternates', async () => {
    const body = [
        '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>',
        '<w:r><w:t>甲</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">乙 </w:t></w:r><w:r><w:br/><w:t>丙&amp;丁&#x4E01;</w:t></w:r></w:p>',
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>',
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        '<w:p><w:ins w:id="1"><w:r><w:t>新增</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>删除</w:delText></w:r></w:del></w:p>',
        '<w:p/><w:p/><w:p/>',
        '<w:tbl><w:tblPr/><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:t>文本框</w:t></w:drawing></mc:Choice>',
        '<mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>文本框</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>',
        '<w:p><w:r><w:t><![CDATA[<原样>]]></w:t></w:r></w:p>',
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
    ].join('');
    assert.equal((await extract('修订.docx', docxPackage(wordDocumentXml(body)))).text, '甲\t乙 \n丙&丁丁\n\n3\n\n新增\n\n单元格\n\n文本框\n\n<原样>');
    const renamed = '<?xml version="1.0"?><x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:r><x:t>别名</x:t></x:r></x:p></x:body></x:document>';
    assert.equal((await extract('别名.docx', docxPackage(renamed, { part: 'word/main.xml', target: '/word/main.xml' }))).text, '别名', 'any prefix, and the part the relationships name');
});

test('a Word file with a missing or malformed body is unreadable', async t => {
    t.mock.method(console, 'warn', () => undefined);
    for (const archive of [
        docxPackage(wordDocumentXml('<w:p><w:r><w:t>未闭合</w:r></w:p>')),
        docxPackage(wordDocumentXml('<w:p/>'), { target: 'word/missing.xml' }),
    ]) {
        const error = await rejection(extract('坏.docx', archive));
        assert.equal(error.code, 'UNREADABLE');
        assert.match(error.message, /^Word 文件无法读取/u);
    }
});

test('a dense Word body is read without building it in memory', async () => {
    const paragraphs = 300_000;
    const body = '<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(paragraphs);
    const before = process.memoryUsage().rss;
    const document = await extract('密集.docx', docxPackage(wordDocumentXml(body)));
    assert.equal(document.text.length, paragraphs * 3 - 2);
    // A DOM of this body takes over two gigabytes; reading it as a stream stays within a small multiple of its size.
    assert.ok(process.memoryUsage().rss - before < 512 * 1024 * 1024, 'memory follows the text, not the element count');
});

test('Excel sheets become tab-separated text with dates, numbers and booleans spelled out', async () => {
    const workbook = xlsxWorkbook([
        { name: '流年', rows: [['年份', '干支', '日期', '分数', '吉'], [2024, '甲辰', { date: 45306 }, 0.1 + 0.2, true], [null, '乙巳']] },
        { name: '空表', rows: [] },
    ]);
    assert.equal((await extract('流年.xlsx', workbook)).text, '## 工作表：流年\n年份\t干支\t日期\t分数\t吉\n2024\t甲辰\t2024-01-15\t0.3\tTRUE\n\t乙巳');
    assert.equal(formatSheet('表', [[' 多行\n内容 ', null, null], [null, null]]), '## 工作表：表\n多行 内容');
});

test('Office archives that would inflate past the budget, are encrypted or are not zips are refused', async () => {
    const bomb = docxPackage(new Uint8Array(33 * 1024 * 1024).fill(0x20));
    assert.ok(bomb.length < 1024 * 1024, 'the archive itself is small');
    const tooLarge = await rejection(extract('炸弹.docx', bomb));
    assert.equal(tooLarge.code, 'TEXT_TOO_LARGE');
    assert.match(tooLarge.message, /^Word 文件内容过多/u);
    const compound = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    assert.match((await rejection(extract('加密.xlsx', compound))).message, /^Excel 文件已加密或为 97-2003 旧格式/u);
    const encrypted = zipArchive([{ name: 'word/document.xml', content: '<w:document/>', encrypted: true }]);
    assert.match((await rejection(extract('加密.docx', encrypted))).message, /^Word 文件已加密/u);
    assert.match((await rejection(extract('坏.docx', utf8('PK not a zip')))).message, /^Word 文件无法读取/u);
});

test('zip reading bounds entries and inflated bytes, refuses duplicates, and repacks exactly what it read', () => {
    const archive = zipArchive([
        { name: 'a.xml', content: '<a/>' },
        { name: 'b.xml', content: '<b/>', stored: true },
        { name: 'media/c.bin', content: new Uint8Array(4096) },
    ]);
    const problem = (bytes: Uint8Array, limits: Parameters<typeof readZipArchive>[1]) => {
        try {
            readZipArchive(bytes, limits);
        } catch (error) {
            assert.ok(error instanceof ZipArchiveError);
            return error.problem;
        }
        return null;
    };
    const parts = readZipArchive(archive, { maxEntries: 3, maxBytes: 8, include: name => name.endsWith('.xml') });
    assert.deepEqual([...parts.keys()], ['a.xml', 'b.xml']);
    assert.equal(problem(archive, { maxEntries: 2, maxBytes: 1024 }), 'too-large', 'entry count');
    assert.equal(problem(archive, { maxEntries: 3, maxBytes: 4096 }), 'too-large', 'inflated bytes');
    assert.equal(problem(archive, { maxEntries: 3, maxBytes: 7 }), 'too-large', 'stored bytes count too');
    assert.equal(problem(zipArchive([{ name: 'a.xml', content: '1' }, { name: 'a.xml', content: '2' }]), { maxEntries: 9, maxBytes: 64 }), 'invalid');
    const shared = zipArchive([
        { name: 'a.xml', content: new Uint8Array(4096), stored: true },
        ...['b.xml', 'c.xml'].map(name => ({ name, content: '', sameDataAs: 'a.xml' })),
    ]);
    assert.equal(problem(shared, { maxEntries: 9, maxBytes: 1 << 20 }), 'invalid', 'entries sharing one stretch of data');
    assert.equal(problem(archive.subarray(0, archive.length - 30), { maxEntries: 9, maxBytes: 1 << 20 }), 'invalid', 'truncated directory');
    assert.equal(problem(new Uint8Array(10), { maxEntries: 9, maxBytes: 64 }), 'invalid');

    const repacked = writeStoredZip(parts);
    assert.equal(repacked.byteOffset, 0);
    assert.equal(repacked.buffer.byteLength, repacked.length, 'owns its buffer');
    const reread = readZipArchive(repacked, { maxEntries: 2, maxBytes: 8 });
    assert.deepEqual([...reread].map(([name, content]) => [name, new TextDecoder().decode(content)]), [['a.xml', '<a/>'], ['b.xml', '<b/>']]);
});
