export type McpPublicTool = {
  id: string;
  label: string;
};

export const MCP_STDIO_PACKAGE_NAME = 'taibu-mcp';
export const MCP_STDIO_GLOBAL_COMMAND = 'taibu-mcp';
export const MCP_PUBLIC_URL = 'https://mcp.mingai.fun/mcp';

export const MCP_PUBLIC_TOOLS: McpPublicTool[] = [
  { id: 'bazi', label: '八字排盘' },
  { id: 'bazi_pillars_resolve', label: '四柱反推' },
  { id: 'bazi_dayun', label: '大运、小运、流年链路' },
  { id: 'bazi_relations', label: '八字刑冲合害详查' },
  { id: 'ziwei', label: '紫微斗数排盘' },
  { id: 'ziwei_horoscope', label: '紫微运限' },
  { id: 'ziwei_flying_star', label: '紫微飞星' },
  { id: 'liuyao', label: '六爻排卦分析' },
  { id: 'meihua', label: '梅花易数起卦与断卦' },
  { id: 'tarot', label: '塔罗抽牌' },
  { id: 'almanac', label: '黄历查询' },
  { id: 'astrology', label: '西方占星命盘与流运' },
  { id: 'qimen', label: '奇门遁甲排盘' },
  { id: 'taiyi', label: '太乙九星观测' },
  { id: 'daliuren', label: '大六壬排盘' },
  { id: 'xiaoliuren', label: '小六壬占测' },
];

export function buildMcpStdioNpxConfig(): string {
  return JSON.stringify({
    mcpServers: {
      taibu: {
        command: 'npx',
        args: ['-y', MCP_STDIO_PACKAGE_NAME],
      },
    },
  }, null, 2);
}

export function buildMcpStdioGlobalConfig(): string {
  return JSON.stringify({
    mcpServers: {
      taibu: {
        command: MCP_STDIO_GLOBAL_COMMAND,
      },
    },
  }, null, 2);
}

export function buildMcpPublicHttpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      taibu: {
        type: 'streamable-http',
        url: MCP_PUBLIC_URL,
      },
    },
  }, null, 2);
}
