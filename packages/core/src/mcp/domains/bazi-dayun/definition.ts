import type { ToolDefinition } from '../../contract.js';
import { baziRuleInputs } from '../../rule-input-schemas.js';

export const baziDayunDefinition: ToolDefinition = {
  name: 'bazi_dayun',
  description: "八字大运 - 根据出生信息计算起运时间与大运列表，可选输出起运前小运及各步大运的流年。full 档输出很长；只问某几年与原局、大运的刑冲合害时，改用 bazi_liunian_scan 或 bazi_relations。",
  inputSchema: {
    type: 'object',
    properties: {
      ...baziRuleInputs,
      yunSect: { type: 'integer', enum: [1, 2], default: 1, description: '起运换算法1或2' },
      gender: { type: 'string', enum: ['male', 'female'], description: '性别' },
      birthYear: { type: 'integer', minimum: 1, maximum: 9999, description: '出生年 (1-9999)' },
      birthMonth: { type: 'integer', minimum: 1, maximum: 12, description: "出生月（1-12）" },
      birthDay: { type: 'integer', minimum: 1, maximum: 31, description: "出生日（公历 1-31，农历 1-30）" },
      birthHour: { type: 'integer', minimum: 0, maximum: 23, description: "出生时（0-23）" },
      birthMinute: { type: 'integer', minimum: 0, maximum: 59, description: "出生分（0-59）", default: 0 },
      calendarType: { type: 'string', enum: ['solar', 'lunar'], description: "出生日期的历法（solar=公历，lunar=农历）", default: 'solar' },
      isLeapMonth: { type: 'boolean', description: "是否农历闰月（仅 calendarType=lunar 时有效）", default: false },
      detailLevel: {
        type: 'string',
        enum: ['default', 'full'],
        description: "输出详略（default=起运信息与大运概要；full=追加起运前小运，以及各步大运的纳音、神煞、原局关系与流年列表）",
        default: 'default',
      },
    },
    required: ['gender', 'birthYear', 'birthMonth', 'birthDay', 'birthHour'],
    examples: [
      { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 },
      { gender: 'female', birthYear: 1995, birthMonth: 6, birthDay: 20, birthHour: 23, calendarType: 'lunar' },
    ],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
