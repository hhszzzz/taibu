import type { ToolDefinition } from '../../contract.js';

export const almanacSelectDefinition: ToolDefinition = {
  name: 'almanac_select',
  description: '黄历择日筛选 - 在指定区间内逐日取黄历，按事项（宜忌逐条匹配）与冲煞（一个或多个生肖、地支的六冲）筛选候选日，列出干支、农历、建除、黄黑道、二十八宿、纳音、冲煞与宜忌，并给出排除统计。只陈列条文，不评定吉凶等级。',
  inputSchema: {
    type: 'object',
    properties: {
      startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '区间起始日（公历 YYYY-MM-DD）' },
      endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '区间结束日（公历 YYYY-MM-DD）；与起始日跨度不超过 92 天' },
      activity: { type: 'string', minLength: 1, maxLength: 20, description: '择日事项，如 嫁娶、开市、动土；省略时列出区间内全部日子' },
      excludeClash: {
        type: 'array', minItems: 1, maxItems: 12,
        items: { type: 'string', minLength: 1, maxLength: 2 },
        description: '需要避冲的生肖（如 牛）或地支（如 丑），可多个（如嫁娶时新人双方的生肖）；按六冲排除当日地支冲其中任何一个的日子',
      },
      timezone: { type: 'string', default: 'Asia/Shanghai', description: 'IANA 时区名（如 Asia/Shanghai）' },
    },
    required: ['startDate', 'endDate'],
    examples: [
      { startDate: '2026-02-14', endDate: '2026-02-20', activity: '嫁娶' },
      { startDate: '2026-02-14', endDate: '2026-02-20', activity: '嫁娶', excludeClash: ['牛', '鸡'] },
    ],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
