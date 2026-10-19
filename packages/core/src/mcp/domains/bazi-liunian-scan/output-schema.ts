import { arr, num, obj, type OutputSchema, str } from '../../schema-builders.js';
import { ganzhiRelationRowSchema } from '../bazi-relations/output-schema.js';

export const baziLiunianScanOutputSchema: OutputSchema = obj({
  扫描范围: obj({
    起始年: num('起始流年'), 结束年: num('结束流年'), 筛选: str('focus 筛选条件'), 列出年数: num('实际列出的年数'),
  }, '扫描的年份范围与筛选'),
  原局四柱: arr(obj({ 柱: str('柱名'), 干支: str('干支') }), '原局四柱'),
  逐年: arr(obj({
    流年: num('流年年份（公历）'), 干支: str('流年干支'), 天干十神: str(), 地支主气十神: str('地支本气相对日主的十神'), 纳音: str(),
    大运: str('所在大运（干支与步数）'), 小运: str('起运前的小运'),
    原局关系: arr(ganzhiRelationRowSchema, '流年与原局四柱的干支关系'),
    大运关系: arr(ganzhiRelationRowSchema, '流年与大运（或小运）共同参与的干支关系'),
    太岁关系: arr(str(), '流年地支与年支的值、冲、合、刑、害、破'),
    岁运提示: arr(str(), '岁运并临、伏吟、天克地冲'),
  }), '逐年事实'),
  口径: arr(str(), '判定口径说明'),
});
