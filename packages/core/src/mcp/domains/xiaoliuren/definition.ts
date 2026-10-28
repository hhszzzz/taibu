import type { ToolDefinition } from '../../contract.js';

export const xiaoliurenDefinition: ToolDefinition = {
  name: 'xiaoliuren',
  description: '小六壬占测 - 根据农历月日时辰起课，输出起课信息、推演链与结果信息。',
  inputSchema: {
    type: 'object',
    properties: {
      lunarMonth: { type: 'integer', minimum: 1, maximum: 12, description: '手工农历月（1-12），与 date 二选一' },
      lunarDay: { type: 'integer', minimum: 1, maximum: 30, description: '手工农历日（1-30）' },
      hour: { type: 'integer', minimum: 0, maximum: 23, description: '小时或时辰序号，由 hourType 明确指定' },
      hourType: { type: 'string', enum: ['clock', 'shichen', 'legacy'], description: 'clock=0-23钟表小时；shichen=子1至亥12时辰序号；legacy=旧版混合口径。date 输入默认 clock，手工农历默认 legacy（手工农历传 1–12 点钟表小时时必须显式传 hourType="clock"）。' },
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '公历日期，与手工农历输入二选一' },
      isLeapMonth: { type: 'boolean', default: false, description: '手工农历是否为闰月' },
      leapMonthStrategy: { type: 'string', enum: ['repeat', 'advance'], default: 'repeat', description: '闰月沿用同月计数或递进一月计数' },
      question: { type: 'string', description: '占问事项' },
      detailLevel: {
        type: 'string',
        enum: ['default', 'full'],
        description: "输出详略（default=起课结果；full=追加释义与诗诀）",
        default: 'default',
      },
    },
    required: ['hour'],
    oneOf: [
      { required: ['lunarMonth', 'lunarDay'], not: { required: ['date'] } },
      { required: ['date'], not: { anyOf: [{ required: ['lunarMonth'] }, { required: ['lunarDay'] }] } },
    ],
    allOf: [{ if: { properties: { hourType: { const: 'shichen' } }, required: ['hourType'] }, then: { properties: { hour: { type: 'integer', minimum: 1, maximum: 12 } } } }],
    examples: [
      { lunarMonth: 3, lunarDay: 15, hour: 8, question: '今日运势如何' },
      { lunarMonth: 1, lunarDay: 1, hour: 1 },
    ],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
