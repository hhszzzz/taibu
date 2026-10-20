import { arr, num, obj, type OutputSchema, str } from '../../schema-builders.js';

export const ganzhiRelationRowSchema = obj({
  类型: str('关系类型（天干五合、天干相冲、六合、三合、半合、三会、六冲、相刑、相害、相破）'),
  位置: arr(obj({
    柱: str('柱名（年柱/月柱/日柱/时柱/大运/小运/流年/流月/流日）'),
    部位: str('天干或地支'),
    字: str('参与的干或支'),
  }), '参与关系的柱位'),
  结果: str('合化或成局五行；刑为刑名'),
  说明: str('关系说明'),
});

/** 给出 pillars / types 时的筛选条件 */
export const relationsFilterSchema = obj({
  柱位: arr(str(), '须同时涉及的柱位（大运在起运前指小运）'),
  类型: arr(str(), '只列的关系类型'),
}, '本次的筛选条件');

/** 筛选后没有列出的事实 */
export const drilldownOmittedSchema = obj({
  条数: num('未列出的事实条数'),
  按类型: arr(obj({ 类型: str('关系类型，或岁运提示、太岁关系'), 条数: num('该类未列出的条数') }), '按类型计数'),
  提示: str('取回全部的方式'),
}, '筛选后没有列出的事实');

export const baziRelationsOutputSchema: OutputSchema = obj({
  查询: obj({
    大运: str('所叠加的大运（序号、干支、起止年份、起运年龄）'),
    小运: str('起运前所叠加的小运'),
    流年: num('流年公历年份'),
    流月: str('流月干支与节气区间'),
    流日: str('流日日期'),
  }, '本次叠加的层次'),
  筛选: relationsFilterSchema,
  参与柱位: arr(obj({
    柱: str('柱名'), 层: str('原局/大运/小运/流年/流月/流日'), 干支: str('干支'),
    天干十神: str(), 地支主气十神: str('地支本气相对日主的十神'), 纳音: str(),
  }), '参与判断的全部柱位（原局四柱与叠加柱）'),
  叠加关系: arr(ganzhiRelationRowSchema, '至少涉及一个叠加柱的干支关系（筛选时只含入选者）；原局之间的关系见八字命盘'),
  同字牵连: arr(ganzhiRelationRowSchema, '不在筛选内、但与所列关系共用同一字（同柱同部位）的叠加关系'),
  岁运提示: arr(str(), '岁运并临、伏吟、天克地冲'),
  太岁关系: arr(str(), '流年地支与年支的值、冲、合、刑、害、破'),
  未列出: drilldownOmittedSchema,
  口径: arr(str(), '判定口径说明'),
});
