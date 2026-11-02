/**
 * Connection and model tests, the same in the browser and on the server (the caller brings the fetch): listing the
 * models checks the address and the key; a tiny chat checks one model and whether it takes a thinking level.
 */
import type { AIReasoningEffort } from '@/types';
import {
  BYOK_MODEL_ID_MAX, byokEndpoint, byokFailureFromMessage, toggleV1Address,
  type ByokFailure, type ByokProtocol,
} from './config';
import { byokContext, collectByokStream, streamByok, type ByokRequestModel } from './pi-model';

export interface ByokProbeOptions {
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
  /** The server's own `User-Agent`; browsers send theirs. */
  userAgent?: string;
}

export type ByokListedModel = { id: string; name?: string };
export type ByokModelList = { ok: true; models: ByokListedModel[] } | { ok: false; failure: ByokFailure };

const LIST_LIMIT = 2000;
const PROBE_TIMEOUT_MS = 30_000;

function failureOf(error: unknown, signal?: AbortSignal): ByokFailure {
  if (signal?.aborted) return { kind: 'aborted' };
  if (error instanceof DOMException && error.name === 'TimeoutError') return { kind: 'timeout' };
  return byokFailureFromMessage(error instanceof Error ? error.message : String(error));
}

/** `GET …/models`: the IDs the key may use. A provider without the endpoint answers 404, which is also reported. */
export async function listByokModels(protocol: ByokProtocol, address: string, apiKey: string, options: ByokProbeOptions): Promise<ByokModelList> {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
  const headers: Record<string, string> = protocol === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', Accept: 'application/json' }
    : { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  if (options.userAgent) headers['User-Agent'] = options.userAgent;
  let response: Response;
  try {
    response = await options.fetch(byokEndpoint(protocol, address).modelsUrl, { method: 'GET', headers, signal });
  } catch (error) {
    return { ok: false, failure: failureOf(error, signal) };
  }
  const body = await response.text().catch(() => '');
  if (!response.ok) return { ok: false, failure: { status: response.status, text: body } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // An HTML page with status 200 means the address points at a website, not the API.
    return { ok: false, failure: { status: 404, text: body.slice(0, 200) || 'not JSON' } };
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { data?: unknown })?.data) ? (parsed as { data: unknown[] }).data : null;
  if (!list) return { ok: false, failure: { status: 404, text: body.slice(0, 200) } };
  const models = new Map<string, ByokListedModel>();
  for (const item of list) {
    const id = typeof item === 'string' ? item : typeof (item as { id?: unknown })?.id === 'string' ? (item as { id: string }).id : '';
    if (!id.trim() || id.length > BYOK_MODEL_ID_MAX || models.has(id)) continue;
    const name = (item as { display_name?: unknown; name?: unknown })?.display_name ?? (item as { name?: unknown })?.name;
    models.set(id, { id, ...(typeof name === 'string' && name.trim() && name !== id ? { name: name.trim() } : {}) });
    if (models.size >= LIST_LIMIT) break;
  }
  return { ok: true, models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

export type ByokConnectionProbe =
  | { ok: true; models: ByokListedModel[] }
  /** `alternative`: the same address with `/v1` toggled answered, so the settings page can offer to use it. */
  | { ok: false; failure: ByokFailure; alternative?: { baseUrl: string; models: ByokListedModel[] } };

/** Lists the models; when that fails for the address (not the key), tries the address with `/v1` added or removed. */
export async function probeByokConnection(protocol: ByokProtocol, address: string, apiKey: string, options: ByokProbeOptions): Promise<ByokConnectionProbe> {
  const listed = await listByokModels(protocol, address, apiKey, options);
  if (listed.ok) return listed;
  const status = listed.failure.status ?? 0;
  const addressProblem = status === 404 || status === 405 || (status >= 300 && status < 400) || listed.failure.kind === 'redirect';
  const alternative = protocol === 'openai' && addressProblem ? toggleV1Address(address) : null;
  if (alternative && !options.signal?.aborted) {
    const retried = await listByokModels(protocol, alternative, apiKey, options);
    if (retried.ok) return { ok: false, failure: listed.failure, alternative: { baseUrl: alternative, models: retried.models } };
  }
  return listed;
}

export type ByokModelTest =
  /** `effort`: whether the model took the level it was asked to think at; `unused` when none was asked. */
  | { ok: true; reply: string; effort: 'accepted' | 'rejected' | 'unused' }
  | { ok: false; failure: ByokFailure };

const TEST_PROMPT = 'Reply with the single word: OK';

async function chatOnce(model: ByokRequestModel, apiKey: string, effort: AIReasoningEffort | null, options: ByokProbeOptions) {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(PROBE_TIMEOUT_MS * 2)]);
  try {
    return await collectByokStream(streamByok(model, byokContext('', [{ role: 'user', content: TEST_PROMPT }]), {
      apiKey, signal, fetch: options.fetch, userAgent: options.userAgent,
      thinking: effort ? { mode: 'level', level: effort } : { mode: 'auto' },
    }));
  } catch (error) {
    return { content: '', reasoning: '', usage: null, error: error instanceof Error ? error.message : String(error), aborted: signal.aborted };
  }
}

/**
 * A tiny chat. With `effort`, a request the provider rejects (400/422) is tried once more without a level: when that
 * one answers, the model works but does not take the level, and its default becomes the model's own.
 */
export async function testByokModel(model: ByokRequestModel, apiKey: string, effort: AIReasoningEffort | null, options: ByokProbeOptions): Promise<ByokModelTest> {
  const first = await chatOnce(model, apiKey, effort, options);
  if (!first.error) return { ok: true, reply: (first.content || first.reasoning).trim().slice(0, 200), effort: effort ? 'accepted' : 'unused' };
  const failure = first.aborted ? { kind: 'aborted' as const } : byokFailureFromMessage(first.error);
  if (effort && (failure.status === 400 || failure.status === 422) && !options.signal?.aborted) {
    const plain = await chatOnce(model, apiKey, null, options);
    if (!plain.error) return { ok: true, reply: (plain.content || plain.reasoning).trim().slice(0, 200), effort: 'rejected' };
  }
  return { ok: false, failure };
}
