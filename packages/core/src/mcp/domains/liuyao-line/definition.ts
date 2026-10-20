import type { ToolInputSchema } from '../../contract.js';

export const LIUYAO_LINE_DESCRIPTION = '六爻逐爻详查 - 在六爻卦盘上按爻位或角色（世、应、动爻、六亲）取爻，列纳甲、六亲、六神、世应、动静、旺衰判据、月破日破暗动与空亡、月建日辰作用、化进化退与回头生克、伏神飞伏，以及动爻对本爻的生克冲合。六亲不上卦时取其伏神所在的飞神爻；动爻作用只列生克冲合，不判有力无力。不给用神取用与应期。';

export const liuyaoLineSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    line: { type: 'integer', minimum: 1, maximum: 6, description: '爻位序号 1–6（1=初爻，6=上爻）；与 role 二选一' },
    role: {
      type: 'string',
      enum: ['世', '应', '动', '父母', '兄弟', '子孙', '妻财', '官鬼'],
      description: '按角色取爻：世、应、动（全部明动之爻）或六亲；六亲不上卦时取其伏神所在的飞神爻；与 line 二选一',
    },
  },
  oneOf: [{ required: ['line'] }, { required: ['role'] }],
  examples: [
    { role: '世' },
    { line: 3 },
  ],
};
