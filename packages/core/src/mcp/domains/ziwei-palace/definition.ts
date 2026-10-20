import type { ToolInputSchema } from '../../contract.js';
import { ZIWEI_PALACE_NAMES, ZIWEI_PALACE_SCOPES } from '../../../domains/ziwei/palace.js';

export const ZIWEI_PALACE_DESCRIPTION = '紫微宫位 - 在紫微命盘上聚焦一宫详查：本宫星曜亮度与生年四化、离心/向心自化，空宫借对宫，三方四正，夹宫，宫干四化飞出与十二宫四化飞入；指定大限、流年、流月、流日或流时时，叠加该运限宫所落的本命宫与运限四化落宫。三方四正取本宫、两个三合宫与对宫；空宫只借对宫主星。只问某宫化忌入哪宫、两宫是否相夹这类单点问题时改用 ziwei_flying_star。只给事实，不下吉凶结论。';

const RUNTIME_SCOPES = ZIWEI_PALACE_SCOPES.filter((scope) => scope !== 'natal');

export const ziweiPalaceSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    palace: { type: 'string', enum: [...ZIWEI_PALACE_NAMES, '仆役'], description: '要详查的宫位（仆役同交友）；非本命层次时指该运限的宫名，如流年财帛' },
    scope: { type: 'string', enum: [...ZIWEI_PALACE_SCOPES], default: 'natal', description: '层次：natal=本命，decadal=大限，yearly=流年，monthly=流月，daily=流日，hourly=流时' },
    targetDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '运限目标日期（公历 YYYY-MM-DD）；非本命层次必填' },
    targetTimeIndex: { type: 'integer', minimum: 0, maximum: 12, description: '流时所用的时辰序号（0-12：0=早子，1=丑…11=亥，12=晚子）；流时层次必填' },
  },
  required: ['palace'],
  allOf: [
    { if: { properties: { scope: { enum: RUNTIME_SCOPES } }, required: ['scope'] }, then: { required: ['targetDate'] } },
    { if: { properties: { scope: { const: 'hourly' } }, required: ['scope'] }, then: { required: ['targetTimeIndex'] } },
  ],
  examples: [
    { palace: '命宫' },
    { palace: '财帛', scope: 'yearly', targetDate: '2026-03-13' },
    { palace: '仆役' },
  ],
};
