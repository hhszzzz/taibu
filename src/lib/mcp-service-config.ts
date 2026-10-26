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
  { id: 'bazi_relations', label: '八字岁运刑冲合害详查' },
  { id: 'bazi_wuxing', label: '八字五行旺衰详查' },
  { id: 'bazi_liunian_scan', label: '八字流年扫描' },
  { id: 'bazi_hepan', label: '八字合盘' },
  { id: 'bazi_hour_candidates', label: '推算出生时辰' },
  { id: 'ziwei', label: '紫微斗数排盘' },
  { id: 'ziwei_horoscope', label: '紫微运限' },
  { id: 'ziwei_flying_star', label: '紫微飞星' },
  { id: 'ziwei_palace', label: '紫微宫位详查' },
  { id: 'liuyao', label: '六爻排卦分析' },
  { id: 'liuyao_line', label: '六爻逐爻详查' },
  { id: 'meihua', label: '梅花易数起卦与断卦' },
  { id: 'tarot', label: '塔罗抽牌' },
  { id: 'almanac', label: '黄历查询' },
  { id: 'almanac_select', label: '黄历择日筛选' },
  { id: 'astrology', label: '西方占星命盘与流运' },
  { id: 'astrology_point', label: '占星单点详查' },
  { id: 'qimen', label: '奇门遁甲排盘' },
  { id: 'qimen_palace', label: '奇门宫位详查' },
  { id: 'taiyi', label: '太乙九星观测' },
  { id: 'daliuren', label: '大六壬排盘' },
  { id: 'daliuren_lessons', label: '大六壬课传详查' },
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
