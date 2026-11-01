import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { testMcpServerInput } from '@/lib/agent/mcp/endpoint.server';
import { McpInputError, parseMcpServerInput, type McpServerFields } from '@/lib/agent/mcp/input.server';

/**
 * 测试未保存的 MCP 配置（管理员预览）。
 * POST body 为完整的 McpServerInput，返回连接结果。
 */
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

  try {
    const body = await request.json().catch(() => null);
    const fields = parseMcpServerInput(body, 'platform', false) as Partial<McpServerFields> & Pick<McpServerFields, 'url'>;

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout((fields.timeoutMs ?? 30_000) + 5_000)]);
    const outcome = await testMcpServerInput(fields as Parameters<typeof testMcpServerInput>[0], { signal });

    return jsonOk({
      success: outcome.error === null,
      message: outcome.error ?? '连接成功',
      snapshot: outcome.snapshot,
    });
  } catch (error) {
    if (error instanceof McpInputError) return jsonError(error.message, 400);
    if (request.signal.aborted) return jsonError('测试已取消', 499);
    if (error instanceof Error && error.name === 'TimeoutError') return jsonError('外部服务响应超时', 504);
    console.error('[mcp-test]', error);
    return jsonError('测试连接失败', 500);
  }
}
