import { arr, num, obj, type OutputSchema, str } from '../../schema-builders.js';

const position = arr(obj({
  宫位: str('宫位名（与 ziwei 十二宫位一致）'),
  星曜: str('星曜名（与 ziwei 星名一致）'),
}), '涉及的宫位或星曜');

const starRow = obj({
  星曜: str('星曜名'), 组别: str('主星及四化/辅星/杂曜'), 亮度: str('亮度'),
  生年四化: str('生年四化（禄/权/科/忌）'), 离心自化: str('离心自化'), 向心自化: str('向心自化'),
  位置: position,
});

const relationRow = obj({
  类型: str('四化或夹星类型'), 位置: position, 结果: str('化出的星曜'), 说明: str('事实说明'),
});

export const ziweiPalaceOutputSchema: OutputSchema = obj({
  查询: obj({ 宫位: str('所查宫位'), 层次: str('本命/大限/流年/流月/流日/流时'), 目标日期: str('运限目标日期'), 时辰序号: num('流时时辰序号') }, '查询参数'),
  宫位概览: obj({
    宫位: str('本命宫位名'), 干支: str('宫干支'), 宫位索引: num(), 身宫: str('是/否'), 来因宫: str('是/否'), 空宫: str('是/否'),
  }, '所查宫位（非本命层次时为运限宫所落的本命宫位）'),
  本宫星曜: arr(starRow, '本宫全部星曜'),
  借对宫: obj({ 对宫: str('对宫宫名'), 干支: str('对宫干支'), 说明: str('借星说明'), 主星: arr(starRow, '所借的对宫主星') }, '空宫借对宫主星'),
  三方四正: arr(obj({
    角色: str('本宫/三合/对宫'), 宫位: str('宫位名'), 干支: str('宫干支'), 主星: str('主星（亮度、生年四化）'), 辅星: str('辅星'),
    生年四化: arr(str(), '该宫的生年四化'), 位置: position,
  }), '三方四正四宫'),
  夹宫: obj({ 两邻: arr(str(), '两邻宫'), 夹星: arr(relationRow, '成对夹星') }, '夹宫'),
  宫干四化飞出: arr(relationRow, '本宫宫干四化的落宫'),
  四化飞入: arr(relationRow, '十二宫宫干四化落入本宫者'),
  运限叠加: obj({
    层次: str(), 运限干支: str('运限干支'), 运限宫位: str('所查的运限宫'), 落入本命宫位: str('运限宫所落的本命宫'),
    运限命宫落入: str('运限命宫所落的本命宫'), 目标日期: str('运限目标日期'), 时辰序号: num('流时时辰序号'),
    运限四化: arr(relationRow, '运限四化落入的本命宫位'),
  }, '运限层次的叠加事实'),
  口径: arr(str(), '判定口径说明'),
});
