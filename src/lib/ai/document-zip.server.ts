import 'server-only';

import { crc32, inflateRawSync } from 'node:zlib';

/**
 * Word and Excel files are zip archives. Parsing libraries trust the sizes an archive declares, so a small upload
 * can expand without bound inside them. These helpers inflate each entry under a hard output limit, then repack the
 * entries uncompressed: whatever a library reads afterwards is exactly the bytes counted here.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const END_RECORD_SIZE = 22;
const MAX_ARCHIVE_COMMENT = 0xffff;
const UTF8_NAMES = 0x0800;
const ENCRYPTED = 0x0001;
const STORED = 0;
const DEFLATED = 8;

export type ZipArchiveProblem = 'invalid' | 'encrypted' | 'too-large';

export class ZipArchiveError extends Error {
    constructor(readonly problem: ZipArchiveProblem) {
        super(`zip archive ${problem}`);
        this.name = 'ZipArchiveError';
    }
}

export interface ZipReadLimits {
    maxEntries: number;
    /** Total size of the entries read, after inflating. */
    maxBytes: number;
    /** Entries to read; the rest are only checked for structure. */
    include?: (name: string) => boolean;
}

function endOfCentralDirectory(view: DataView): number {
    const last = view.byteLength - END_RECORD_SIZE;
    for (let offset = last; offset >= Math.max(0, last - MAX_ARCHIVE_COMMENT); offset -= 1) {
        if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
    }
    throw new ZipArchiveError('invalid');
}

function inflate(data: Uint8Array, maxOutput: number): Uint8Array {
    try {
        return inflateRawSync(data, { maxOutputLength: Math.max(1, maxOutput) });
    } catch (error) {
        throw new ZipArchiveError((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE' ? 'too-large' : 'invalid');
    }
}

/** Reads entries through the central directory. ZIP64, encrypted and duplicate entries are refused. */
export function readZipArchive(bytes: Uint8Array, limits: ZipReadLimits): Map<string, Uint8Array> {
    if (bytes.length < END_RECORD_SIZE) throw new ZipArchiveError('invalid');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = endOfCentralDirectory(view);
    const count = view.getUint16(end + 10, true);
    const directorySize = view.getUint32(end + 12, true);
    const directoryOffset = view.getUint32(end + 16, true);
    if (count === 0xffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > end) throw new ZipArchiveError('invalid');
    if (count > limits.maxEntries) throw new ZipArchiveError('too-large');

    const names = new TextDecoder();
    const entries = new Map<string, Uint8Array>();
    const seen = new Set<string>();
    let total = 0;
    // Entries of a well-formed archive never share bytes, so together they fit before the directory. Entries pointing
    // at the same data would inflate it again for each one, holding the event loop far longer than the archive's size.
    let compressedTotal = 0;
    let cursor = directoryOffset;
    for (let index = 0; index < count; index += 1) {
        if (cursor + 46 > end || view.getUint32(cursor, true) !== CENTRAL_HEADER) throw new ZipArchiveError('invalid');
        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const next = cursor + 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
        if (next > end) throw new ZipArchiveError('invalid');
        const localOffset = view.getUint32(cursor + 42, true);
        const name = names.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        cursor = next;
        if (seen.has(name)) throw new ZipArchiveError('invalid');
        seen.add(name);
        if (flags & ENCRYPTED) throw new ZipArchiveError('encrypted');
        if (name.endsWith('/') || (limits.include && !limits.include(name))) continue;

        if (localOffset + 30 > directoryOffset || view.getUint32(localOffset, true) !== LOCAL_HEADER) throw new ZipArchiveError('invalid');
        const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const dataEnd = dataStart + compressedSize;
        compressedTotal += compressedSize;
        if (dataEnd > directoryOffset || compressedTotal > directoryOffset) throw new ZipArchiveError('invalid');
        const data = bytes.subarray(dataStart, dataEnd);
        const room = limits.maxBytes - total;
        let content: Uint8Array;
        if (method === STORED) content = data;
        else if (method === DEFLATED) content = inflate(data, room);
        else throw new ZipArchiveError('invalid');
        if (content.length > room) throw new ZipArchiveError('too-large');
        total += content.length;
        entries.set(name, content);
    }
    return entries;
}

/** Packs entries into a new uncompressed archive on its own ArrayBuffer. */
export function writeStoredZip(entries: ReadonlyMap<string, Uint8Array>): Uint8Array<ArrayBuffer> {
    // A plain archive counts entries in 16 bits and offsets in 32; readZipArchive limits keep far below both.
    if (entries.size > 0xffff) throw new RangeError('Too many zip entries');
    const encoder = new TextEncoder();
    const records = [...entries].map(([name, content]) => ({ name: encoder.encode(name), content, crc: crc32(content), offset: 0 }));
    const localSize = records.reduce((sum, record) => sum + 30 + record.name.length + record.content.length, 0);
    const directorySize = records.reduce((sum, record) => sum + 46 + record.name.length, 0);
    const archive = new Uint8Array(localSize + directorySize + END_RECORD_SIZE);
    const view = new DataView(archive.buffer);
    let cursor = 0;
    for (const record of records) {
        record.offset = cursor;
        view.setUint32(cursor, LOCAL_HEADER, true);
        view.setUint16(cursor + 4, 20, true);
        view.setUint16(cursor + 6, UTF8_NAMES, true);
        view.setUint16(cursor + 8, STORED, true);
        view.setUint32(cursor + 14, record.crc, true);
        view.setUint32(cursor + 18, record.content.length, true);
        view.setUint32(cursor + 22, record.content.length, true);
        view.setUint16(cursor + 26, record.name.length, true);
        archive.set(record.name, cursor + 30);
        archive.set(record.content, cursor + 30 + record.name.length);
        cursor += 30 + record.name.length + record.content.length;
    }
    for (const record of records) {
        view.setUint32(cursor, CENTRAL_HEADER, true);
        view.setUint16(cursor + 4, 20, true);
        view.setUint16(cursor + 6, 20, true);
        view.setUint16(cursor + 8, UTF8_NAMES, true);
        view.setUint16(cursor + 10, STORED, true);
        view.setUint32(cursor + 16, record.crc, true);
        view.setUint32(cursor + 20, record.content.length, true);
        view.setUint32(cursor + 24, record.content.length, true);
        view.setUint16(cursor + 28, record.name.length, true);
        view.setUint32(cursor + 42, record.offset, true);
        archive.set(record.name, cursor + 46);
        cursor += 46 + record.name.length;
    }
    view.setUint32(cursor, END_OF_CENTRAL_DIRECTORY, true);
    view.setUint16(cursor + 8, records.length, true);
    view.setUint16(cursor + 10, records.length, true);
    view.setUint32(cursor + 12, directorySize, true);
    view.setUint32(cursor + 16, localSize, true);
    return archive;
}
