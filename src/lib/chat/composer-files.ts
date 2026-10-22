/**
 * 输入框之外进入的文件（拖放到会话区、粘贴）统一交给输入框现有的附件流程：
 * Agent 走私有资料上传，普通对话沿用单文件提取附件。
 */
import { DOCUMENT_ACCEPT, documentRejection, MAX_DOCUMENT_BYTES } from '@/lib/ai/document-formats';
import { requestBrowserPayloadOrThrow } from '@/lib/browser-api';
import type { ChatAttachment } from '@/types';

/** Window event the conversation area uses to hand dropped files to the mounted composer. */
export const COMPOSER_FILES_EVENT = 'taibu:composer-files';

export function dispatchComposerFiles(files: File[]) {
    if (files.length) window.dispatchEvent(new CustomEvent<File[]>(COMPOSER_FILES_EVENT, { detail: files }));
}

const isImage = (file: Pick<File, 'name' | 'type'>) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic)$/i.test(file.name);

/** `accept` of Agent pickers: the images the vision model reads, then the documents read as text. */
export const PRIVATE_ATTACHMENT_ACCEPT = `.jpg,.jpeg,.png,.webp,${DOCUMENT_ACCEPT}`;

/** Why a document cannot be attached, found before it is uploaded; null when it can. */
export function documentFileProblem(file: Pick<File, 'name' | 'size'>): string | null {
    return documentRejection(file.name) ?? (file.size > MAX_DOCUMENT_BYTES ? '文件不能超过 10MB' : null);
}

/**
 * Plain chat carries one extracted document per message and no images. Returns the file it
 * can take and the toast explaining anything left out (null when everything was accepted).
 */
export function pickPlainAttachment<T extends Pick<File, 'name' | 'type'>>(files: readonly T[]): { file: T | null; notice: string | null } {
    const documents = files.filter(file => !isImage(file));
    const images = documents.length < files.length;
    const file = documents.find(item => !documentRejection(item.name)) ?? null;
    if (!file) return { file, notice: documents.length ? documentRejection(documents[0].name) : '图片需切换到 Agent 模式' };
    if (images) return { file, notice: '图片需切换到 Agent 模式，已只添加文档' };
    if (files.length > 1) return { file, notice: `普通对话每次只能附加一个文件，已添加「${file.name}」` };
    return { file, notice: null };
}

/** Reads a plain chat document's text on the server; the message carries the text, never the file. */
export async function extractPlainAttachment(file: File): Promise<ChatAttachment> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await requestBrowserPayloadOrThrow<Partial<ChatAttachment>>('/api/chat/extract', { method: 'POST', body: form }, '文件解析失败，请重试');
    if (typeof data?.name !== 'string' || typeof data.text !== 'string') throw new Error('文件解析失败，请重试');
    return { name: data.name, text: data.text };
}

/** Whether a drag carries files (not text or links dragged inside the page). */
export const dragHasFiles = (types: readonly string[] | DOMStringList) => Array.from(types).includes('Files');
