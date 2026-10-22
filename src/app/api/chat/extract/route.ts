import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, readUploadedFile, requireUserContext } from '@/lib/api-utils';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { MAX_DOCUMENT_BYTES } from '@/lib/ai/document-formats';
import { DOCUMENT_TEXT_RATE_LIMIT, DocumentTextError, documentTextErrorStatus, extractDocumentText } from '@/lib/ai/document-text.server';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/** Reads one document's text for a plain chat message to carry; nothing is stored. */
export async function POST(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const guard = await getGlobalAIFeatureGuardResponse();
    if (guard) return guard;
    if (!(await checkRateLimit(auth.user.id, DOCUMENT_TEXT_RATE_LIMIT.endpoint, DOCUMENT_TEXT_RATE_LIMIT)).allowed) {
        return jsonError('请求过于频繁，请稍后再试', 429);
    }
    const upload = await readUploadedFile(request, MAX_DOCUMENT_BYTES);
    if ('error' in upload) return jsonError(upload.error.message, upload.error.status);
    try {
        const bytes = new Uint8Array(await upload.file.arrayBuffer());
        const document = await extractDocumentText({ name: upload.file.name, bytes }, request.signal);
        return jsonOk({ name: document.name, text: document.text });
    } catch (error) {
        if (error instanceof DocumentTextError) return jsonError(error.message, documentTextErrorStatus(error), { code: error.code });
        if (!request.signal.aborted) console.error('[chat/extract]', error instanceof Error ? error.name : typeof error);
        return jsonError('文件解析失败，请重试', 500);
    }
}
