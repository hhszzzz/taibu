/**
 * 平台 MCP 服务：管理员接入的外部服务，按会员等级对所有用户开放；联网搜索的路由也从这里配置。
 *
 * 'use client' 标记说明：
 * - 列表与编辑交给 McpServerManager
 */
'use client';

import { McpServerManager } from '@/components/settings/mcp/McpServerManager';

const notice = () => (
  <p className="mcp-notice">
    服务的工具按「提供方式」交给 Agent，只在开启联网的任务中使用。服务自带的说明、工具描述与返回内容都按外部资料对待，不会成为模型的指令；密钥加密保存，保存后不再显示。
  </p>
);

export function AgentMcpPanel() {
  return (
    <McpServerManager
      scope="platform"
      addLabel="自定义服务"
      notice={notice}
      empty={{ title: '还没有接入 MCP 服务', detail: '可以从 Exa、Tavily 模板添加，或填写任意 Streamable HTTP 服务的地址。' }}
    />
  );
}
