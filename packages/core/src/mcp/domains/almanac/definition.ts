import type { ToolDefinition } from '../../contract.js';
import { birthDateTogetherRule } from '../../rule-input-schemas.js';

export const almanacDefinition: ToolDefinition = {
  name: 'almanac',
  description: '黄历查询 - 查询指定日期的黄历、宜忌、冲煞、值星、方位与时辰吉凶等信息。',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: { type: 'string', default: 'Asia/Shanghai', description: '省略日期时按此 IANA 时区取今日' },
      dayMaster: {
        type: 'string',
        enum: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
        description: "日主天干（用于计算当日日干对日主的十神；优先于出生信息）",
      },
      birthYear: {
        type: 'integer', minimum: 1, maximum: 9999,
        description: "出生年（未提供 dayMaster 时，由出生年月日推算日主）",
      },
      birthMonth: {
        type: 'integer', minimum: 1, maximum: 12,
        description: "出生月（1-12；用于推算日主）",
      },
      birthDay: {
        type: 'integer', minimum: 1, maximum: 31,
        description: "出生日（1-31；用于推算日主）",
      },
      birthHour: {
        type: 'integer', minimum: 0, maximum: 23,
        description: "出生时（0-23；用于推算日主，省略时按 12 时计）",
      },
      date: {
        type: 'string',
        description: "查询日期（公历 YYYY-MM-DD；省略时取当前日期）",
      },
      detailLevel: {
        type: 'string',
        enum: ['default', 'full'],
        description: '输出详略（default=基础黄历、冲煞与宜忌；full=追加方位、建除值神、二十八宿、纳音与十二时辰吉凶）',
        default: 'default',
      },
    },
    required: [],
    allOf: [birthDateTogetherRule],
    examples: [
      { birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, date: '2026-02-14' },
      { dayMaster: '丙', date: '2026-02-14' },
    ],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
