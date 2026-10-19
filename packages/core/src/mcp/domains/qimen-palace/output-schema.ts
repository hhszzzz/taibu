import { arr, num, obj, type OutputSchema, str } from '../../schema-builders.js';

const positionSchema = obj({
  宫位序号: num('宫位序号 1–9'),
  部位: str('宫内部位（九星/八门/八神/天盘天干/地盘天干）'),
});

export const qimenFactRowSchema = obj({
  类型: str('事实类型'),
  位置: arr(positionSchema, '涉及的宫位与部位'),
  结果: str('结果简称'),
  说明: str('事实说明'),
});

export const qimenPalaceOutputSchema: OutputSchema = obj({
  查询: obj({ 方式: str('指定宫位或定位依据'), 宫位: str('所查宫位'), 定位: str('定位说明'), 同见宫位: arr(str(), '定位对象同时出现的其他宫位') }, '本次详查的宫位'),
  宫位: obj({ 宫名: str(), 宫位序号: num('宫位序号 1–9'), 宫位: str(), 方位: str(), 宫位五行: str(), 宫旺衰: str('宫五行按月令的旺衰') }),
  天地盘: obj({
    天盘天干: str(), 天盘天干五行: str(), 天盘天干旺衰: str('天盘干按月令的旺衰'),
    地盘天干: str(), 地盘天干五行: str(), 地盘天干旺衰: str('地盘干按月令的旺衰'),
    寄天盘干: arr(str(), '随寄宫同落本宫的天盘干'), 寄地盘干: arr(str(), '寄于本宫的地盘干'),
  }),
  星门神: obj({ 九星: str(), 九星五行: str(), 寄星: arr(str(), '寄于本宫的星'), 八门: str(), 八门五行: str(), 八神: str() }),
  中宫寄宫: arr(str(), '转盘中五的寄宫去向'),
  状态: arr(str(), '日空、时空、驿马、入墓、门迫、六仪击刑'),
  柱干落宫: arr(qimenFactRowSchema, '年月日时干落于本宫天盘或地盘'),
  遁甲: arr(str(), '时旬首所遁六仪在本宫'),
  生克: arr(qimenFactRowSchema, '门宫、星宫、天盘干与宫、地盘干与宫、天地盘干的五行生克'),
  值符值使: obj({ 值符: str('值符星与落宫'), 值使: str('值使门与落宫'), 本宫: str('本宫是否值符宫、值使宫') }),
  格局: arr(str(), '全盘格局与本宫格局'),
  口径: arr(str(), '判定口径说明'),
});
