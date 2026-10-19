import type { ToolInputSchema } from '../../contract.js';

export const ASTROLOGY_POINT_DESCRIPTION = '占星单点详查 - 在西方占星命盘上详查一颗星体（含交点、莉莉丝、上升、天顶）或一个宫位：星座宫位与逆行、托勒密传统尊贵、主管宫位或宫主星落点、本命相位（标入相／出相）、流运触发或流运过境。只给事实，不下吉凶结论。';

const PLANET_LABELS = '太阳 sun、月亮 moon、水星 mercury、金星 venus、火星 mars、木星 jupiter、土星 saturn、天王星 uranus、海王星 neptune、冥王星 pluto、北交点 northnode、南交点 southnode、莉莉丝 lilith、上升点 ascendant、天顶 midheaven';

export const astrologyPointSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    planet: {
      type: 'string',
      enum: ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'northnode', 'southnode', 'lilith', 'ascendant', 'midheaven'],
      description: `要详查的星体或点（${PLANET_LABELS}）；与 house 二选一，上升与天顶需要经纬度`,
    },
    house: { type: 'integer', minimum: 1, maximum: 12, description: '要详查的宫位序号 1–12；与 planet 二选一，需要出生地经纬度' },
  },
  oneOf: [{ required: ['planet'] }, { required: ['house'] }],
  examples: [
    { planet: 'venus' },
    { house: 7 },
  ],
};
