import 'server-only';
import { validateMcpServerUrl } from '../safe-fetch.server';
import {
  MCP_EXPOSURES, MCP_RESULT_ADAPTERS, MCP_RESULT_CHARS_RANGE, MCP_SERVER_NAME_PATTERN, MCP_TIMEOUT_RANGE, USER_MCP_EXPOSURES,
  isMembershipTier, type McpExposure, type McpResultAdapter, type McpToolPolicy,
} from './config';
import type { MembershipType } from '@/lib/user/membership';

/** A submission the settings pages can show as is. */
export class McpInputError extends Error {}

const fail = (message: string): never => { throw new McpInputError(message); };

const HEADER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const QUERY_NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
/** Set by the transport or meaningless for a JSON-RPC endpoint. */
const RESERVED_HEADERS = new Set([
  'host', 'content-length', 'content-type', 'accept', 'connection', 'transfer-encoding', 'te', 'upgrade', 'keep-alive',
  'proxy-connection', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id', 'cookie', 'origin', 'referer',
]);
/** A plain header that looks like a credential belongs among the secret headers, which are never shown again. */
const SENSITIVE_HEADER = /auth|token|secret|key|signature|session|password|credential/u;
const HEADER_LIMIT = 20, SECRET_LIMIT = 10, TOOL_POLICY_LIMIT = 500;

export type McpServerFields = {
  name: string;
  displayName: string;
  description: string;
  url: string;
  headers: Record<string, string>;
  secretHeaders: Record<string, string | null>;
  secretQuery: Record<string, string | null>;
  exposure: McpExposure;
  toolPolicy: Record<string, McpToolPolicy>;
  searchTool: string | null;
  fetchTool: string | null;
  resultAdapter: McpResultAdapter;
  routePriority: number;
  requiredTier: MembershipType;
  enabled: boolean;
  timeoutMs: number;
  maxResultChars: number;
  sortOrder: number;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式无效`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, min = 0) {
  if (typeof value !== 'string') return fail(`${label}格式无效`);
  const trimmed = value.trim();
  if (trimmed.length < min) fail(`请填写${label}`);
  if (trimmed.length > max) fail(`${label}最多 ${max} 字`);
  return trimmed;
}

function integer(value: unknown, label: string, min: number, max: number) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(`${label}须为 ${min}–${max} 的整数`);
  return value as number;
}

function headerName(raw: string) {
  const name = raw.trim().toLowerCase();
  if (!HEADER_NAME.test(name)) fail(`请求头名称「${raw}」无效`);
  if (RESERVED_HEADERS.has(name)) fail(`请求头「${name}」由连接自动设置，不能自定义`);
  return name;
}

function headers(value: unknown) {
  const entries = Object.entries(record(value, '请求头'));
  if (entries.length > HEADER_LIMIT) fail(`请求头最多 ${HEADER_LIMIT} 个`);
  const result: Record<string, string> = {};
  for (const [raw, content] of entries) {
    const name = headerName(raw);
    if (SENSITIVE_HEADER.test(name)) fail(`请求头「${name}」像是密钥，请填到密钥请求头中`);
    if (typeof content !== 'string' || content.length > 1024 || CONTROL.test(content)) fail(`请求头「${name}」的值无效`);
    if (Object.hasOwn(result, name)) fail(`请求头「${name}」重复`);
    result[name] = content as string;
  }
  return result;
}

/** Write-only secret changes: a value sets or replaces, null removes. */
function secretChanges(value: unknown, kind: 'header' | 'query') {
  const entries = Object.entries(record(value, kind === 'header' ? '密钥请求头' : '密钥查询参数'));
  if (entries.length > SECRET_LIMIT) fail(`${kind === 'header' ? '密钥请求头' : '密钥查询参数'}最多 ${SECRET_LIMIT} 个`);
  const result: Record<string, string | null> = {};
  for (const [raw, content] of entries) {
    const name = kind === 'header' ? headerName(raw) : raw.trim();
    if (kind === 'query' && !QUERY_NAME.test(name)) fail(`查询参数名称「${raw}」无效`);
    if (Object.hasOwn(result, name)) fail(`密钥「${name}」重复`);
    if (content === null) { result[name] = null; continue; }
    if (typeof content !== 'string' || !content.trim() || content.length > (kind === 'header' ? 8192 : 4096) || CONTROL.test(content))
      fail(`密钥「${name}」的值无效`);
    result[name] = (content as string).trim();
  }
  return result;
}

function toolPolicy(value: unknown) {
  const entries = Object.entries(record(value, '工具设置'));
  if (entries.length > TOOL_POLICY_LIMIT) fail(`工具设置最多 ${TOOL_POLICY_LIMIT} 项`);
  const result: Record<string, McpToolPolicy> = {};
  for (const [name, raw] of entries) {
    if (!name || name.length > 128 || CONTROL.test(name)) fail('工具名称无效');
    const item = record(raw, `工具「${name}」的设置`);
    const policy: McpToolPolicy = {};
    if (item.enabled !== undefined) policy.enabled = typeof item.enabled === 'boolean' ? item.enabled : fail('工具开关无效');
    if (item.confirm !== undefined) policy.confirm = typeof item.confirm === 'boolean' ? item.confirm : fail('工具确认设置无效');
    if (item.title !== undefined && item.title !== '') policy.title = text(item.title, '工具标题', 40);
    if (item.keywords !== undefined && item.keywords !== '') policy.keywords = text(item.keywords, '检索关键词', 200);
    if (Object.keys(policy).length) result[name] = policy;
  }
  return result;
}

function routeTool(value: unknown, label: string) {
  if (value === null || value === '') return null;
  return text(value, label, 128, 1);
}

/**
 * Checks a create (`partial` false: name, display name and URL required) or a change (`partial` true: only the fields
 * given). A user's connector cannot route search, choose a tier, or hide behind code mode.
 */
export function parseMcpServerInput(body: unknown, scope: 'platform' | 'user', partial: boolean): Partial<McpServerFields> {
  const raw = record(body, '请求');
  const has = (key: string) => raw[key] !== undefined;
  const result: Partial<McpServerFields> = {};
  if (has('name') || !partial) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!MCP_SERVER_NAME_PATTERN.test(name)) fail('标识须以小写字母开头，只含小写字母、数字和下划线，2–31 个字符');
    result.name = name;
  }
  if (has('displayName') || !partial) result.displayName = text(raw.displayName, '名称', 40, 1);
  if (has('description')) result.description = text(raw.description, '用途说明', 2000);
  if (has('url') || !partial) {
    const url = text(raw.url, '服务地址', 2048, 1);
    try { validateMcpServerUrl(url); } catch (error) { fail(error instanceof Error ? error.message : '服务地址无效'); }
    result.url = new URL(url).href;
  }
  if (has('headers')) result.headers = headers(raw.headers);
  if (has('secretHeaders')) result.secretHeaders = secretChanges(raw.secretHeaders, 'header');
  if (has('secretQuery')) result.secretQuery = secretChanges(raw.secretQuery, 'query');
  if (result.headers && result.secretHeaders) {
    const clash = Object.keys(result.secretHeaders).find(name => Object.hasOwn(result.headers!, name));
    if (clash) fail(`请求头「${clash}」不能同时作为普通请求头和密钥`);
  }
  if (has('exposure')) {
    const allowed: readonly string[] = scope === 'user' ? USER_MCP_EXPOSURES : MCP_EXPOSURES;
    if (!allowed.includes(raw.exposure as string)) fail('暴露方式无效');
    result.exposure = raw.exposure as McpExposure;
  }
  if (has('toolPolicy')) result.toolPolicy = toolPolicy(raw.toolPolicy);
  if (scope === 'platform') {
    if (has('searchTool')) result.searchTool = routeTool(raw.searchTool, '搜索工具');
    if (has('fetchTool')) result.fetchTool = routeTool(raw.fetchTool, '抓取工具');
    if (has('resultAdapter')) {
      if (!(MCP_RESULT_ADAPTERS as readonly string[]).includes(raw.resultAdapter as string)) fail('结果解析方式无效');
      result.resultAdapter = raw.resultAdapter as McpResultAdapter;
    }
    if (has('routePriority')) result.routePriority = integer(raw.routePriority, '路由优先级', 0, 1000);
    if (has('requiredTier')) {
      if (!isMembershipTier(raw.requiredTier)) fail('会员等级无效');
      result.requiredTier = raw.requiredTier as MembershipType;
    }
  } else if (['searchTool', 'fetchTool', 'resultAdapter', 'routePriority', 'requiredTier'].some(key => has(key) && raw[key] !== null)) {
    fail('个人连接器不能设置联网路由或会员等级');
  }
  if (has('enabled')) result.enabled = typeof raw.enabled === 'boolean' ? raw.enabled : fail('启用状态无效');
  if (has('timeoutMs')) result.timeoutMs = integer(raw.timeoutMs, '超时毫秒数', MCP_TIMEOUT_RANGE.min, MCP_TIMEOUT_RANGE.max);
  if (has('maxResultChars')) result.maxResultChars = integer(raw.maxResultChars, '结果字数上限', MCP_RESULT_CHARS_RANGE.min, MCP_RESULT_CHARS_RANGE.max);
  if (has('sortOrder')) result.sortOrder = integer(raw.sortOrder, '排序', -10_000, 10_000);
  return result;
}
