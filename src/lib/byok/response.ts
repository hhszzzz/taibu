import { readBoundedStream } from '@/lib/streams/read-bounded';

export const BYOK_RESPONSE_BODY_TOO_LARGE = 'Provider response exceeded its size limit';

/** How much of a provider's error text is kept for the user. */
export const PROVIDER_ERROR_MAX_BYTES = 64 * 1024;

/** Refuses a large declared or streamed provider response before retaining the full body. */
export async function readByokResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RangeError(BYOK_RESPONSE_BODY_TOO_LARGE);
  }
  try {
    return await readBoundedStream(response.body, maxBytes);
  } catch (error) {
    if (error instanceof RangeError)
      throw new RangeError(BYOK_RESPONSE_BODY_TOO_LARGE);
    throw error;
  }
}

export async function readByokResponseText(response: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readByokResponse(response, maxBytes));
}
