import 'server-only';

import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DocumentTextError, type DocumentFormat, type DocumentTextErrorCode } from './document-formats';
import type { DocumentParser } from './document-text.server';

/**
 * Runs the PDF, Word and Excel parsers in worker threads, a new thread for each document. A thread past its time is
 * terminated mid-parse, and one past its memory is stopped before it takes the server with it: V8 bounds its heap,
 * and the buffers outside the heap, where pdf.js inflates streams, are measured while it runs.
 */

/** Where `pnpm build:agent` and `pnpm dev` bundle `document-text.worker.ts` (scripts/build-document-worker.mjs). */
export const DOCUMENT_WORKER_FILE = path.join(process.cwd(), '.agent', 'document-text-worker.mjs');

export interface DocumentWorkerLimits {
    /** Documents parsed at once in this process; the others wait their turn. */
    concurrency: number;
    /** Maximum waiting documents retained in this process. */
    maxWaiting: number;
    /** How long a document waits for its turn before it is refused as busy. */
    waitMs: number;
    /** JavaScript heap of one thread; V8 stops the thread past it. */
    heapMb: number;
    /** Memory one thread holds outside its heap, such as inflated PDF streams. */
    bufferMb: number;
}

/**
 * One parse at a time within the container budget: web runs with a 448MB heap
 * inside a 640MB limit, so two 256MB parsers plus buffers would let two
 * hostile documents get the container OOM-killed. A waiting document queues
 * instead of starting a second thread.
 */
export const DOCUMENT_WORKER_LIMITS: Readonly<DocumentWorkerLimits> = { concurrency: 1, maxWaiting: 8, waitMs: 5_000, heapMb: 160, bufferMb: 160 };
/** How often a running thread's buffers are measured; a parse overshoots the budget by what it allocates in between. */
const MEMORY_CHECK_MS = 50;
const MB = 1024 * 1024;

/** One document for the worker. */
export interface DocumentWorkerJob {
    name: string;
    format: DocumentFormat;
    bytes: Uint8Array;
}

/** The worker's answer: the document's text, why the document was refused, or the name of the error a parser threw. */
export type DocumentWorkerResult =
    | { text: string }
    | { refusal: { code: DocumentTextErrorCode; message: string } }
    | { failure: string };

/** The worker failed itself (it could not start, or stopped without answering), rather than the document. */
export class DocumentWorkerError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'DocumentWorkerError';
    }
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code ?? (error instanceof Error ? error.name : typeof error);

/** A parser that reads each document in a new thread running `file`, within `limits`. */
export function createDocumentWorkerParser(file: string, limits: Readonly<DocumentWorkerLimits> = DOCUMENT_WORKER_LIMITS): DocumentParser {
    let running = 0;
    const waiting: Array<() => void> = [];

    /** Resolves when a thread may start for one more document. */
    function turn(signal: AbortSignal): Promise<void> {
        if (signal.aborted) return Promise.reject(signal.reason);
        if (running < limits.concurrency) {
            running += 1;
            return Promise.resolve();
        }
        if (waiting.length >= limits.maxWaiting) return Promise.reject(new DocumentTextError('BUSY', '文件解析繁忙，请稍后重试'));
        return new Promise((resolve, reject) => {
            const start = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
                running += 1;
                resolve();
            };
            const leave = (reason: unknown) => {
                const index = waiting.indexOf(start);
                if (index >= 0) waiting.splice(index, 1);
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
                reject(reason);
            };
            const abort = () => leave(signal.reason);
            const timer = setTimeout(() => leave(new DocumentTextError('BUSY', '文件解析繁忙，请稍后重试')), limits.waitMs);
            signal.addEventListener('abort', abort, { once: true });
            waiting.push(start);
        });
    }

    function release() {
        running -= 1;
        waiting.shift()?.();
    }

    /** Parses one document in its own thread; the turn taken for it is given back when the thread has exited. */
    function parse(job: DocumentWorkerJob, signal: AbortSignal): Promise<string> {
        return new Promise((resolve, reject) => {
            // The thread receives exactly the document's bytes, moved rather than copied a second time.
            const bytes = job.bytes.slice();
            let worker: Worker;
            try {
                worker = new Worker(file, {
                    name: 'document-text',
                    workerData: { ...job, bytes } satisfies DocumentWorkerJob,
                    transferList: [bytes.buffer],
                    // The parsers need neither the server's flags (or a test runner's loader) nor its environment.
                    execArgv: [],
                    env: {},
                    resourceLimits: { maxOldGenerationSizeMb: limits.heapMb },
                });
            } catch (error) {
                release();
                console.error('[document-worker]', { code: errorCode(error) });
                reject(new DocumentWorkerError('The document worker could not start', { cause: error }));
                return;
            }
            const tooLarge = () => new DocumentTextError('TEXT_TOO_LARGE', `${job.format.label} 文件内容过多，请拆分后上传`);
            let settled = false;
            const finish = (settle: () => void) => {
                if (settled) return;
                settled = true;
                clearInterval(measure);
                signal.removeEventListener('abort', abort);
                settle();
                void worker.terminate();
            };
            const abort = () => finish(() => reject(signal.reason));
            const measure = setInterval(() => {
                worker.getHeapStatistics().then(
                    stats => {
                        if (stats.external_memory > limits.bufferMb * MB) finish(() => reject(tooLarge()));
                    },
                    // The thread has exited; its exit settles the parse.
                    () => undefined,
                );
            }, MEMORY_CHECK_MS);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            worker.once('message', (result: DocumentWorkerResult) => finish(() => {
                if ('text' in result) resolve(result.text);
                else if ('refusal' in result) reject(new DocumentTextError(result.refusal.code, result.refusal.message));
                else {
                    // Named for the parser's error, which the extractor reports as an unreadable file.
                    const failure = new Error('A document parser failed');
                    failure.name = result.failure;
                    reject(failure);
                }
            }));
            worker.once('error', error => finish(() => {
                if (errorCode(error) === 'ERR_WORKER_OUT_OF_MEMORY') return reject(tooLarge());
                console.error('[document-worker]', { code: errorCode(error) });
                reject(new DocumentWorkerError('The document worker failed', { cause: error }));
            }));
            worker.once('exit', code => {
                finish(() => {
                    console.error('[document-worker]', { code: 'EXIT', exitCode: code });
                    reject(new DocumentWorkerError(`The document worker exited with code ${code} without answering`));
                });
                release();
            });
        });
    }

    return async (bytes, { name, format, signal }) => {
        await turn(signal);
        return parse({ name, format, bytes }, signal);
    };
}
