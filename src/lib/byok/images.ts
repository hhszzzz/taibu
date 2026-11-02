/**
 * Own image models (OpenAI `/images/generations`), the same code in the browser (key on the device) and on the server
 * (key stored here, Agent tasks). Each image is its own request: many models make one per call.
 */
import { ByokRequestError, byokEndpoint, byokFailureFromMessage, type ByokFailure } from './config';

/** OpenAI's GPT image models always answer in base64 and reject `response_format`. */
const BASE64_ONLY_PREFIXES = ['chatgpt-image-', 'gpt-image-'];

export type ByokImage = { bytes: Uint8Array<ArrayBuffer>; mediaType: string };

export interface ByokImageRequest {
  baseUrl: string;
  modelId: string;
  apiKey: string;
  prompt: string;
  size: string;
  count: number;
  signal?: AbortSignal;
  /** The browser passes `byokBrowserFetch`; the server its public-address guard. */
  fetch: typeof globalThis.fetch;
  /** The server's `User-Agent`; a browser sends its own. */
  userAgent?: string;
  /** The request goes straight from the user's browser (for the error hint). */
  browser?: boolean;
}

type ImagesResponse = { data?: Array<{ b64_json?: unknown; url?: unknown }> };

export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function failure(error: unknown, request: ByokImageRequest): never {
  if (request.signal?.aborted) throw error;
  if (error instanceof ByokRequestError) throw error;
  const failed: ByokFailure = byokFailureFromMessage(error instanceof Error ? error.message : String(error));
  throw new ByokRequestError(failed.kind || failed.status ? failed : { kind: 'network', text: failed.text }, { browser: request.browser });
}

async function readImage(item: { b64_json?: unknown; url?: unknown } | undefined, request: ByokImageRequest): Promise<ByokImage> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof item?.b64_json === 'string' && item.b64_json) {
    bytes = base64Bytes(item.b64_json);
  } else if (typeof item?.url === 'string' && /^https:\/\//u.test(item.url)) {
    let response: Response;
    try {
      response = await request.fetch(item.url, { signal: request.signal });
    } catch (error) {
      failure(error, request);
    }
    if (!response.ok) throw new ByokRequestError({ status: response.status, text: '读取生成的图片失败' }, { browser: request.browser });
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new ByokRequestError({ text: '生图模型没有返回图片' }, { browser: request.browser });
  }
  const mediaType = sniffImageType(bytes);
  if (!mediaType) throw new ByokRequestError({ text: '生图模型返回的不是 PNG、JPEG 或 WebP 图片' }, { browser: request.browser });
  return { bytes, mediaType };
}

async function generateOne(request: ByokImageRequest): Promise<ByokImage> {
  const url = byokEndpoint('openai', request.baseUrl).imagesUrl;
  if (!url) throw new ByokRequestError({ text: '这个连接不能生图' });
  let response: Response;
  try {
    response = await request.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
        ...(request.userAgent ? { 'User-Agent': request.userAgent } : {}),
      },
      body: JSON.stringify({
        model: request.modelId, prompt: request.prompt, n: 1, size: request.size,
        ...(BASE64_ONLY_PREFIXES.some(prefix => request.modelId.startsWith(prefix)) ? {} : { response_format: 'b64_json' }),
      }),
      signal: request.signal,
    });
  } catch (error) {
    failure(error, request);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ByokRequestError({ status: response.status, text }, { browser: request.browser });
  }
  const payload = await response.json().catch(() => null) as ImagesResponse | null;
  return readImage(payload?.data?.[0], request);
}

/** As many images as the model delivered; the first failure is thrown when it delivered none. */
export async function generateByokImages(request: ByokImageRequest): Promise<ByokImage[]> {
  const settled = await Promise.allSettled(Array.from({ length: request.count }, () => generateOne(request)));
  const images = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
  if (images.length) return images;
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  throw rejected?.reason ?? new ByokRequestError({ text: '生图模型没有返回图片' }, { browser: request.browser });
}
