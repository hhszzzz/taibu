/**
 * 知识库文件导入规则
 *
 * 上传接口与设置页共用同一份规则，避免界面提示与服务端校验各写一份而不一致。
 * 服务端按纯文本读取文件内容（file.text()），因此不接受 PDF、Word 等二进制格式。
 */

export const KNOWLEDGE_FILE_MAX_BYTES = 5 * 1024 * 1024;
const KNOWLEDGE_FILE_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.json'] as const;
const KNOWLEDGE_FILE_MAX_LABEL = `${KNOWLEDGE_FILE_MAX_BYTES / 1024 / 1024}MB`;
const KNOWLEDGE_FILE_TYPES_LABEL = '.txt、.md、.csv、.json 等纯文本文件';

/** 供 `<input type="file" accept>` 使用，放行范围与 validateKnowledgeFile 一致。 */
export const KNOWLEDGE_FILE_ACCEPT = ['text/*', 'application/json', ...KNOWLEDGE_FILE_EXTENSIONS].join(',');

export const KNOWLEDGE_FILE_HINT = `支持 ${KNOWLEDGE_FILE_TYPES_LABEL}，单个文件不超过 ${KNOWLEDGE_FILE_MAX_LABEL}`;

/** 返回面向用户的错误文案；文件可以导入时返回 null。 */
export function validateKnowledgeFile(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
    if (!isPlainTextFile(file)) return `只支持 ${KNOWLEDGE_FILE_TYPES_LABEL}`;
    if (file.size === 0) return '文件内容为空';
    if (file.size > KNOWLEDGE_FILE_MAX_BYTES) return `文件不能超过 ${KNOWLEDGE_FILE_MAX_LABEL}`;
    return null;
}

// 浏览器对 .md 等扩展名常给出空 MIME，类型不明时再按扩展名判断。
function isPlainTextFile(file: Pick<File, 'name' | 'type'>): boolean {
    if (file.type.startsWith('text/') || file.type === 'application/json') return true;
    const name = file.name.toLowerCase();
    return KNOWLEDGE_FILE_EXTENSIONS.some(extension => name.endsWith(extension));
}
