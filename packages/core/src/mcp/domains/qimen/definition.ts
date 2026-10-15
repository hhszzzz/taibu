import type { ToolDefinition } from '../../contract.js';

export const qimenCalculateDefinition: ToolDefinition = {
  name: 'qimen',
  description: '奇门遁甲排盘 - 根据指定时间排出奇门盘，输出九宫、九星、八门、八神、格局等信息。',
  inputSchema: {
    type: 'object',
    properties: {
      year: { type: 'integer', minimum: 1900, maximum: 2100, description: "公历年（1900-2100）" },
      month: { type: 'integer', minimum: 1, maximum: 12, description: "月（1-12）" },
      day: { type: 'integer', minimum: 1, maximum: 31, description: "日（1-31）" },
      hour: { type: 'integer', minimum: 0, maximum: 23, description: "时（0-23）" },
      minute: { type: 'integer', minimum: 0, maximum: 59, description: "分（0-59）", default: 0 },
      timezone: { type: 'string', description: "IANA 时区名（如 Asia/Shanghai）", default: 'Asia/Shanghai' },
      question: { type: 'string', description: '占问事项' },
      panType: { type: 'string', enum: ['zhuan', 'fei'], description: '盘式（zhuan=时家转盘，fei=洛书飞盘，八门含虚中位）', default: 'zhuan' },
      juMethod: { type: 'string', enum: ['chaibu', 'maoshan', 'equal'], description: '定局法（chaibu=拆补，maoshan=交节后每五日一元，equal=节气区间等时三分，现代扩展）', default: 'chaibu' },
      flyStarMethod: { type: 'string', enum: ['forward', 'yin-reverse'], description: '飞盘九星：forward=阴阳皆顺，yin-reverse=阳顺阴逆；默认阳顺阴逆' },
      juNumber: { type: 'integer', minimum: 1, maximum: 9, description: '手工局数，必须与 dunType 同时提供' },
      dunType: { type: 'string', enum: ['yang', 'yin'], description: '手工阴阳遁，必须与 juNumber 同时提供' },
      zhiFuJiGong: { type: 'string', enum: ['ji_wugong', 'ji_liuyi'], description: '转盘中五寄宫（ji_wugong=固定寄坤二宫；ji_liuyi=阳遁寄艮八、阴遁寄坤二）', default: 'ji_wugong' },
      detailLevel: {
        type: 'string',
        enum: ['default', 'full'],
        description: "输出详略（default=核心盘面与全局格局；full=追加历法信息、宫位方位旺衰与逐宫格局、空亡、驿马、十干旺衰）",
        default: 'default',
      },
    },
    required: ['year', 'month', 'day', 'hour'],
    allOf: [
      { if: { required: ['juNumber'] }, then: { required: ['dunType'] } },
      { if: { required: ['dunType'] }, then: { required: ['juNumber'] } },
    ],
    examples: [
      { year: 2026, month: 3, day: 15, hour: 16, minute: 51, timezone: 'Asia/Shanghai', question: '事业发展如何？' },
    ],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
export const qimenDefinition = qimenCalculateDefinition;
