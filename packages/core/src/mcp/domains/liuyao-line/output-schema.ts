import { arr, num, obj, type OutputSchema, str } from '../../schema-builders.js';

const cellSchema = obj({
  爻位: str('爻位名（如初九、六二）'),
  序号: num('爻位序号（1=初爻）'),
  部位: str('本爻、伏神或变爻'),
});

const actionSchema = obj({
  类型: str('作用（生、克、扶、冲、合、相破）'),
  位置: arr(cellSchema, '作用的来源爻与目标爻'),
  说明: str('作用说明'),
});

export const liuyaoLineOutputSchema: OutputSchema = obj({
  查询: obj({
    爻位: num('查询的爻位序号'), 角色: str('查询的角色'), 本卦: str('本卦卦名'), 变卦: str('变卦卦名'),
    月建: str('月建地支'), 日辰: str('日辰地支'),
  }, '查询条件与卦时'),
  爻详情: arr(obj({
    爻位: str(), 序号: num('爻位序号（1=初爻）'), 六亲: str(), 六神: str(), 纳甲: str(), 五行: str(),
    世应: str('世爻或应爻'), 动静: str(), 旺衰: str(), 旺衰判据: arr(str(), '旺衰所据的日月作用'),
    特殊状态: str('月破、日破或暗动'), 空亡: str('空亡状态（真空、假空、动空、冲空、临建）'), 长生: str('对日辰的十二长生'),
    月建作用: str(), 日辰作用: str(),
    变爻: obj({ 六亲: str(), 纳甲: str(), 五行: str(), 化变: str('化进、化退、回头生克、化墓绝空等') }),
    伏神: obj({ 六亲: str(), 纳甲: str(), 五行: str(), 飞伏关系: str('飞神与伏神的生克') }),
    取爻说明: str('按六亲取到伏神时的说明'),
    受动爻作用: arr(actionSchema, '明动、暗动之爻对本爻的作用'),
    动而作用: arr(actionSchema, '本爻发动时对他爻的作用'),
    位置: arr(cellSchema, '对应盘面位置'),
  }), '所取各爻的事实'),
  说明: str('取爻说明（静卦无动爻、六亲不上卦等）'),
  口径: arr(str(), '判定口径说明'),
});
