import { arr, obj, type OutputSchema, str } from '../../schema-builders.js';

/** 合盘的关系行：柱名带称呼（如「甲方日柱」） */
const hepanRelationRowSchema = obj({
  类型: str('关系类型（天干五合、天干相冲、六合、三合、半合、三会、六冲、相刑、相害、相破）'),
  位置: arr(obj({
    柱: str('称呼加柱名，如「甲方日柱」'),
    部位: str('天干或地支'),
    字: str('参与的干或支'),
  }), '参与关系的柱位'),
  结果: str('合化或成局五行；刑为刑名'),
  说明: str('关系说明'),
});

export const baziHepanOutputSchema: OutputSchema = obj({
  双方: arr(obj({
    称呼: str('称呼'),
    性别: str('性别'),
    四柱: arr(obj({ 柱: str('柱名'), 干支: str('干支'), 纳音: str('纳音') }), '四柱（年 月 日 时；出生时辰未知时没有时柱）'),
    日主: str('命主五行'),
    月令: str('月令地支'),
    月令旺衰: str('日主在月令中的旺衰（旺/相/休/囚/死）'),
    生肖: str('生肖（年柱地支，立春换年）'),
    缺失五行: arr(str(), '天干、地支本气与藏干都没有出现的五行'),
    出生时辰: str('只在这一方出生时辰未知时出现：没有时柱，两盘之间的关系不含其时柱'),
  }), '双方四柱要点'),
  日主互见: obj({
    说明: arr(str(), '对方日主相对己方日主的十神'),
    五行生克: str('两日主的五行生克'),
  }, '日主互见'),
  年命纳音: obj({
    说明: str('双方年柱纳音'),
    五行生克: str('纳音五行生克'),
  }, '年命纳音'),
  日柱之间: arr(hepanRelationRowSchema, '同时涉及双方日柱的关系（日主与夫妻宫）'),
  年柱之间: arr(hepanRelationRowSchema, '同时涉及双方年柱、不涉及双方日柱的关系（生肖）'),
  其余关系: arr(hepanRelationRowSchema, '两盘之间的其余干支关系'),
  五行互补: arr(str(), '一方缺失、另一方原局有的五行'),
  口径: arr(str(), '判定口径说明'),
});
