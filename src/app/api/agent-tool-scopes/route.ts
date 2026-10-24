import { NextRequest } from 'next/server';
import {
  AGENT_TOOL_SCOPE_IDS,
  getAgentToolScopes,
  setAgentToolScope,
  type AgentToolScopeId,
} from '@/lib/app-settings';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';

/** Agent tool scope policy is administrator-only; runtime checks read the same app_settings rows. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

  try {
    const scopes = await getAgentToolScopes();
    return jsonOk({ scopes });
  } catch (error) {
    console.error('[agent-tool-scopes] Failed to read scopes:', error);
    return jsonError('读取 Agent 工具范围失败', 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    const body = await request.json();
    const { scopeId, disabled } = body as { scopeId?: unknown; disabled?: unknown };
    if (
      typeof scopeId !== 'string'
      || !(AGENT_TOOL_SCOPE_IDS as readonly string[]).includes(scopeId)
      || typeof disabled !== 'boolean'
    ) {
      return jsonError('无效的 Agent 工具范围参数', 400);
    }

    const success = await setAgentToolScope(scopeId as AgentToolScopeId, disabled);
    if (!success) return jsonError('更新 Agent 工具范围失败', 500);
    return jsonOk({ success: true, scopeId, disabled });
  } catch (error) {
    console.error('[agent-tool-scopes] Error:', error);
    return jsonError('服务器错误', 500);
  }
}
