import type { CustomProviderRequest } from '@/types';
import { normalizeCustomProviderBaseUrl } from '@/lib/ai/custom-provider-url';
import { BrowserDirectProviderError, normalizeBrowserDirectError } from '@/lib/ai/browser-direct-provider';

/** OpenAI's GPT image models always answer in base64 and reject `response_format` (the AI SDK's list). */
const DEFAULT_BASE64_MODEL_PREFIXES = ['chatgpt-image-', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-1'];

type ImagesResponse = { data?: Array<{ b64_json?: unknown; url?: unknown }>; error?: { message?: unknown } | string };

function sniffImageType(bytes: Uint8Array): string {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
    return 'application/octet-stream';
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function readImage(item: { b64_json?: unknown; url?: unknown } | undefined, signal?: AbortSignal): Promise<Blob> {
    let bytes: Uint8Array<ArrayBuffer>;
    if (typeof item?.b64_json === 'string' && item.b64_json) {
        bytes = base64Bytes(item.b64_json);
    } else if (typeof item?.url === 'string' && /^https:\/\//u.test(item.url)) {
        let response: Response;
        try {
            response = await fetch(item.url, { signal });
        } catch (error) {
            if (signal?.aborted) throw error;
            throw new BrowserDirectProviderError('图片地址无法读取（可能有跨域限制），请换用返回 base64 的生图模型', { code: 'CORS_OR_NETWORK' });
        }
        if (!response.ok) throw new BrowserDirectProviderError(`读取生成的图片失败（${response.status}）`, { status: response.status, code: 'REQUEST_FAILED' });
        bytes = new Uint8Array(await response.arrayBuffer());
    } else {
        throw new BrowserDirectProviderError('生图模型没有返回图片', { code: 'INVALID_RESPONSE' });
    }
    return new Blob([bytes], { type: sniffImageType(bytes) });
}

async function generateOne(provider: CustomProviderRequest & { imageModelId: string }, prompt: string, size: string, signal?: AbortSignal): Promise<Blob> {
    const model = provider.imageModelId;
    const response = await fetch(`${normalizeCustomProviderBaseUrl(provider.apiUrl)}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
            model, prompt, n: 1, size,
            ...(DEFAULT_BASE64_MODEL_PREFIXES.some(prefix => model.startsWith(prefix)) ? {} : { response_format: 'b64_json' }),
        }),
        signal,
    });
    const payload = await response.json().catch(() => null) as ImagesResponse | null;
    if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : typeof payload?.error?.message === 'string' ? payload.error.message : '';
        if (response.status === 401) throw new BrowserDirectProviderError('模型认证失败，请检查 API Key 是否正确', { status: 401, code: 'AUTH_FAILED' });
        throw new BrowserDirectProviderError(message || `生图请求失败（${response.status}）`, { status: response.status, code: 'REQUEST_FAILED' });
    }
    return readImage(payload?.data?.[0], signal);
}

/**
 * 用自定义生图模型在浏览器里直接生成：每张单独请求（不少模型一次只出一张），能出几张算几张；一张都没有时抛出第一个错误。
 * 图片随后由调用方上传到本站保存。
 */
export async function generateBrowserDirectImages(options: {
    provider: CustomProviderRequest & { imageModelId: string };
    prompt: string;
    size: string;
    count: number;
    signal?: AbortSignal;
}): Promise<Blob[]> {
    const settled = await Promise.allSettled(Array.from({ length: options.count }, () => generateOne(options.provider, options.prompt, options.size, options.signal)));
    const images = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
    if (images.length) return images;
    const failure = settled.find(result => result.status === 'rejected');
    throw normalizeBrowserDirectError(failure?.status === 'rejected' ? failure.reason : null);
}
