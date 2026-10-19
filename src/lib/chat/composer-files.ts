/**
 * 输入框之外进入的文件（拖放到会话区、粘贴）统一交给输入框现有的附件流程：
 * Agent 走私有资料上传，普通对话沿用单文件提取附件。
 */

/** Window event the conversation area uses to hand dropped files to the mounted composer. */
export const COMPOSER_FILES_EVENT = 'taibu:composer-files';

export function dispatchComposerFiles(files: File[]) {
    if (files.length) window.dispatchEvent(new CustomEvent<File[]>(COMPOSER_FILES_EVENT, { detail: files }));
}

const isImage = (file: Pick<File, 'name' | 'type'>) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic)$/i.test(file.name);
const PLAIN_DOCUMENT = /\.(pdf|txt|md|doc|docx|xlsx|xls|csv)$/i;

/**
 * Plain chat carries one extracted document per message and no images. Returns the file it
 * can take and the toast explaining anything left out (null when everything was accepted).
 */
export function pickPlainAttachment<T extends Pick<File, 'name' | 'type'>>(files: readonly T[]): { file: T | null; notice: string | null } {
    const documents = files.filter(file => !isImage(file) && PLAIN_DOCUMENT.test(file.name));
    const images = files.some(isImage);
    const file = documents[0] ?? null;
    if (!file) return { file, notice: images ? '图片需切换到 Agent 模式' : '不支持该文件类型' };
    if (images) return { file, notice: '图片需切换到 Agent 模式，已只添加文档' };
    if (files.length > 1) return { file, notice: '普通对话每次只能附加一个文件，已使用第一个' };
    return { file, notice: null };
}

/** Whether a drag carries files (not text or links dragged inside the page). */
export const dragHasFiles = (types: readonly string[] | DOMStringList) => Array.from(types).includes('Files');
