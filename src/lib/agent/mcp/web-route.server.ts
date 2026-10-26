import 'server-only';
import { toLlmContent, type CallToolResult, type Tool } from '@earendil-works/pi-mcp';
import { systemDb } from '@/lib/db/context.server';
import type { MembershipType } from '@/lib/user/membership';
import { MEMBERSHIP_TIERS, meetsTier } from './config';
import { describeMcpError, resolveMcpServer, type ResolvedMcpServer } from './endpoint.server';
import { mcpPool, type McpPool } from './pool.server';
import { platformMcpServers, recordMcpServerCheck, type McpServerRow } from './store.server';
import { WEB_SEARCH_QUERY_MAX, httpUrl, parseWebPage, parseWebSearchResults, type WebPage, type WebSearchResult, type WebToolOutput } from './web-results';

/**
 * Web search and page reading for the Agent's `web_search` / `web_fetch` and plain chat's search, routed to the
 * platform MCP servers an administrator gave a search or fetch tool. Servers are tried in their route order; an
 * error, a timeout, an error result or nothing found moves on to the next. A server that failed three times in a row
 * rests for a minute in this process, and its error is shown on the admin page until it answers again. Users' own
 * connectors never route.
 */

export type WebRouteKind = 'search' | 'fetch';

/** No server serves this member, or every one is resting after repeated failures. */
export class WebRouteUnavailableError extends Error {}

/** A failure worded here: a missing tool or an error result. `rest` is false when the page is at fault, not the server. */
class RouteCallError extends Error {
  constructor(message: string, readonly rest = true) {
    super(message);
  }
}

const WEB_SEARCH_LIMIT = { default: 5, max: 10 } as const;
const WEB_FETCH_CHARS = { default: 8_000, max: 20_000 } as const;
/** One search result's text: enough to judge and cite it; the model reads the page with web_fetch for more. */
const RESULT_CHARS = 1_500;
const TITLE_CHARS = 200;
const BREAKER_FAILURES = 3;
const BREAKER_REST_MS = 60_000;
const KIND_LABELS: Record<WebRouteKind, string> = { search: '联网搜索', fetch: '网页读取' };

/** Argument names the common search and page tools use for the result count and the page length. */
const LIMIT_KEYS = ['numResults', 'num_results', 'max_results', 'maxResults', 'limit', 'count'];
const CHARS_KEYS = ['maxCharacters', 'max_characters', 'maxChars', 'max_chars'];

type PropertySchema = { type?: unknown; minimum?: unknown; maximum?: unknown };

function inputShape(tool: Tool) {
  const schema = (tool.inputSchema ?? {}) as { properties?: unknown; required?: unknown };
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, PropertySchema> : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [];
  return { properties, required };
}

/** The first preferred argument the tool has, else its first (required) string argument. */
function stringArgument(tool: Tool, preferred: readonly string[]) {
  const { properties, required } = inputShape(tool);
  const strings = (keys: readonly string[]) => keys.find((key) => properties[key]?.type === 'string');
  return preferred.find((key) => Object.hasOwn(properties, key)) ?? strings(required) ?? strings(Object.keys(properties));
}

function bounded(schema: PropertySchema | undefined, value: number) {
  const min = typeof schema?.minimum === 'number' ? schema.minimum : -Infinity;
  const max = typeof schema?.maximum === 'number' ? schema.maximum : Infinity;
  const clamped = Math.min(Math.max(value, min), max);
  return schema?.type === 'integer' ? Math.round(clamped) : clamped;
}

/** Arguments for a search tool, read from the schema it lists: the query, and the result count when it takes one. */
export function searchArguments(tool: Tool, query: string, limit: number): Record<string, unknown> {
  const { properties } = inputShape(tool);
  const args: Record<string, unknown> = { [stringArgument(tool, ['query', 'q', 'search_query', 'searchQuery']) ?? 'query']: query };
  const limitKey = LIMIT_KEYS.find((key) => Object.hasOwn(properties, key));
  if (limitKey) args[limitKey] = bounded(properties[limitKey], limit);
  return args;
}

/** Arguments for a page tool: the address (as a list when it takes several), and the page length when it takes one. */
export function fetchArguments(tool: Tool, url: string, chars: number): Record<string, unknown> {
  const { properties } = inputShape(tool);
  const args: Record<string, unknown> = {};
  if (Object.hasOwn(properties, 'urls')) args.urls = properties.urls?.type === 'string' ? url : [url];
  else if (Object.hasOwn(properties, 'url')) args.url = properties.url?.type === 'array' ? [url] : url;
  else args[stringArgument(tool, ['link', 'href', 'page']) ?? 'url'] = url;
  const charsKey = CHARS_KEYS.find((key) => Object.hasOwn(properties, key));
  if (charsKey) args[charsKey] = bounded(properties[charsKey], chars);
  return args;
}

/** At most `max` characters, never splitting a surrogate pair, marked when cut. */
function clip(text: string, max: number, marker = '…') {
  if (text.length <= max) return text;
  let end = max;
  if (/[\uD800-\uDBFF]/u.test(text[end - 1] ?? '')) end--;
  return `${text.slice(0, end).trimEnd()}${marker}`;
}

const routeTool = (row: McpServerRow, kind: WebRouteKind) => kind === 'search' ? row.search_tool : row.fetch_tool;
/** Names differ only by `-` or `_` between a service's releases (Tavily's hosted `tavily-search`). */
const sameToolName = (left: string, right: string) => left.replaceAll('-', '_') === right.replaceAll('-', '_');

type Breaker = { failures: number; restUntil: number; reported: boolean };

export class WebRouter {
  private readonly breakers = new Map<string, Breaker>();

  constructor(private readonly deps: {
    pool?: McpPool;
    servers?: () => Promise<McpServerRow[]>;
    /** Shows a resting server's error on the admin page, or clears it once the server answers. */
    report?: (serverId: string, error: string | null) => Promise<unknown>;
    now?: () => number;
  } = {}) {}

  private get pool() {
    return this.deps.pool ?? mcpPool;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private servers() {
    return (this.deps.servers ?? platformMcpServers)();
  }

  private report(serverId: string, error: string | null) {
    const report = this.deps.report ?? ((id: string, text: string | null) => recordMcpServerCheck(systemDb(), null, id, { snapshot: null, error: text }));
    void report(serverId, error).catch(() => undefined);
  }

  /** Enabled platform servers with a tool for `kind` that the member's tier reaches, in the order they are tried. */
  async routes(kind: WebRouteKind, membership: MembershipType): Promise<McpServerRow[]> {
    return (await this.servers())
      .filter((row) => row.is_enabled && routeTool(row, kind) && meetsTier(membership, row.required_tier))
      .sort((left, right) => left.route_priority - right.route_priority || left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  }

  /** Whether a server serves this member; false when the servers cannot be read. */
  async available(kind: WebRouteKind, membership: MembershipType): Promise<boolean> {
    try {
      return (await this.routes(kind, membership)).length > 0;
    } catch {
      return false;
    }
  }

  /** The lowest tier any server serves, or null when none is set up (or the servers cannot be read). */
  async lowestTier(kind: WebRouteKind): Promise<MembershipType | null> {
    try {
      const rows = (await this.servers()).filter((row) => row.is_enabled && routeTool(row, kind));
      return MEMBERSHIP_TIERS.find((tier) => rows.some((row) => meetsTier(tier, row.required_tier))) ?? null;
    } catch {
      return null;
    }
  }

  private breaker(kind: WebRouteKind, row: McpServerRow) {
    return `${kind}:${row.id}`;
  }

  private failed(kind: WebRouteKind, row: McpServerRow, reason: string) {
    const key = this.breaker(kind, row);
    const breaker = this.breakers.get(key) ?? { failures: 0, restUntil: 0, reported: false };
    breaker.failures++;
    if (breaker.failures >= BREAKER_FAILURES) {
      breaker.restUntil = this.now() + BREAKER_REST_MS;
      if (!breaker.reported) {
        breaker.reported = true;
        this.report(row.id, `${KIND_LABELS[kind]}连续失败，已暂停 1 分钟：${reason}`);
      }
    }
    this.breakers.set(key, breaker);
  }

  private answered(kind: WebRouteKind, row: McpServerRow) {
    const key = this.breaker(kind, row);
    const breaker = this.breakers.get(key);
    if (!breaker) return;
    this.breakers.delete(key);
    if (breaker.reported) this.report(row.id, null);
  }

  /**
   * Calls `kind`'s tool on each server in turn until one gives something `read` accepts. Null when every server
   * answered but none had anything; throws the last failure when none answered.
   */
  private async route<T>(
    kind: WebRouteKind, membership: MembershipType, signal: AbortSignal | undefined,
    args: (tool: Tool) => Record<string, unknown>, read: (output: WebToolOutput) => T | null,
  ): Promise<T | null> {
    const routes = await this.routes(kind, membership);
    if (!routes.length) throw new WebRouteUnavailableError(`当前没有可用的${KIND_LABELS[kind]}服务`);
    const now = this.now();
    const ready = routes.filter((row) => (this.breakers.get(this.breaker(kind, row))?.restUntil ?? 0) <= now);
    if (!ready.length) throw new WebRouteUnavailableError(`${KIND_LABELS[kind]}服务连续出错，请稍后再试`);
    let failure: string | undefined;
    let answered = false;
    for (const row of ready) {
      signal?.throwIfAborted();
      let resolved: ResolvedMcpServer | undefined;
      try {
        resolved = resolveMcpServer(row);
        const output = await this.call(kind, row, resolved, args, signal);
        this.answered(kind, row);
        answered = true;
        const value = read(output);
        if (value !== null) return value;
      } catch (error) {
        signal?.throwIfAborted();
        failure = error instanceof RouteCallError ? error.message : describeMcpError(error, resolved?.scrub ?? ((text) => text));
        if (!(error instanceof RouteCallError) || error.rest) this.failed(kind, row, failure);
        console.warn('[web-route]', { server: row.id, kind, code: 'ROUTE_FAILED' });
      }
    }
    if (!answered && failure) throw new Error(`${KIND_LABELS[kind]}失败：${failure}`);
    return null;
  }

  private async call(
    kind: WebRouteKind, row: McpServerRow, resolved: ResolvedMcpServer,
    args: (tool: Tool) => Record<string, unknown>, signal: AbortSignal | undefined,
  ): Promise<WebToolOutput> {
    const wanted = routeTool(row, kind)!;
    const { tools } = await this.pool.describe(resolved.endpoint, { signal });
    const tool = tools.find((item) => item.name === wanted) ?? tools.find((item) => sameToolName(item.name, wanted));
    if (!tool) throw new RouteCallError(`外部服务没有「${wanted}」这个工具，请在管理页测试连接后重选`);
    const result: CallToolResult = await this.pool.callTool(resolved.endpoint, tool.name, args(tool), { signal, timeoutMs: row.timeout_ms });
    const text = resolved.scrub(toLlmContent({ content: result.content }).flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n'));
    // A page that cannot be read is the page's fault; any other error result is the server's.
    if (result.isError) throw new RouteCallError(`外部服务报错：${clip(text.replace(/\s+/gu, ' ').trim(), 300) || '没有说明原因'}`, kind === 'search');
    let structured: unknown;
    if (result.structuredContent !== undefined) {
      try { structured = JSON.parse(resolved.scrub(JSON.stringify(result.structuredContent))); } catch { structured = undefined; }
    }
    return { text, structured };
  }

  /** Up to `limit` results from the first server that finds any; empty when every server answered without one. */
  async search(query: string, options: { membership: MembershipType; signal?: AbortSignal; limit?: number }): Promise<WebSearchResult[]> {
    const text = Array.from(query.replace(/\s+/gu, ' ').trim()).slice(0, WEB_SEARCH_QUERY_MAX).join('');
    if (!text) throw new Error('搜索词不能为空');
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? WEB_SEARCH_LIMIT.default), 1), WEB_SEARCH_LIMIT.max);
    const results = await this.route('search', options.membership, options.signal,
      (tool) => searchArguments(tool, text, limit),
      (output) => {
        const found = parseWebSearchResults(output);
        return found.length ? found : null;
      });
    return (results ?? []).slice(0, limit).map((result) => ({
      ...result, title: clip(result.title, TITLE_CHARS), content: clip(result.content, RESULT_CHARS),
    }));
  }

  /** The text of one public page, cut to `maxChars`; throws when no server could read it. */
  async fetch(url: string, options: { membership: MembershipType; signal?: AbortSignal; maxChars?: number }): Promise<WebPage> {
    const address = httpUrl(url);
    if (!address) throw new Error('只能读取 http(s) 网页地址');
    const parsed = new URL(address);
    if (parsed.username || parsed.password) throw new Error('网页地址不能包含账号或密码');
    parsed.hash = '';
    const chars = Math.min(Math.max(Math.trunc(options.maxChars ?? WEB_FETCH_CHARS.default), 1_000), WEB_FETCH_CHARS.max);
    const page = await this.route('fetch', options.membership, options.signal,
      (tool) => fetchArguments(tool, parsed.href, chars),
      (output) => parseWebPage(output, parsed.href));
    if (!page) throw new Error('没有读到这个网页的正文');
    return { ...page, title: clip(page.title, TITLE_CHARS), content: clip(page.content, chars, '\n…（后文省略）') };
  }
}

/** The process's router, shared by the Agent's tools and plain chat. */
export const webRouter = new WebRouter();

export function webRouteAvailable(kind: WebRouteKind, membership: MembershipType) {
  return webRouter.available(kind, membership);
}

export function webRouteLowestTier(kind: WebRouteKind) {
  return webRouter.lowestTier(kind);
}

export function searchWeb(query: string, options: { membership: MembershipType; signal?: AbortSignal; limit?: number }) {
  return webRouter.search(query, options);
}

export function fetchWebPage(url: string, options: { membership: MembershipType; signal?: AbortSignal; maxChars?: number }) {
  return webRouter.fetch(url, options);
}
