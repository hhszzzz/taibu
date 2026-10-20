import { arr, num, obj, type OutputSchema, str } from '../../schema-builders.js';

const cellSchema = obj({
  盘: str('本命或流运'),
  标识: str('星体或点的标识（如 sun、ascendant）'),
  因素: str('星体或点的名称'),
});

const placementSchema = obj({
  因素: str('星体或点'), 标识: str('星体或点的标识'), 星座: str(), 元素: str('星座元素'), 模式: str('星座模式（本位/固定/变动）'),
  黄经: str('黄经（绝对黄经 / 星座内度数）'), 宫位: str('所落宫位'), 逆行: str('是否逆行（是/否）'),
  位置: arr(cellSchema, '对应盘面位置'),
});

const aspectSchema = obj({
  类型: str('相位（合相、对冲、三分、四分、六合）'),
  位置: arr(cellSchema, '相位两端'),
  容许度: num('相位容许度（度）'),
  实际夹角: num('实际夹角（度）'),
  相态: str('入相或出相；交点与轴点不标'),
  说明: str('相位说明'),
});

export const astrologyPointOutputSchema: OutputSchema = obj({
  查询: obj({ 对象: str('详查对象'), 类型: str('星体或宫位'), 范围: str('只看本命或只看流运时给出') }, '本次详查的对象'),
  位置信息: placementSchema,
  传统尊贵: arr(str(), '托勒密传统尊贵（入庙、擢升、失势、落陷，或无）'),
  主管宫位: arr(str(), '该行星按传统守护主管的宫位'),
  宫位信息: obj({ 宫位: str(), 宫位序号: num(), 宫头星座: str(), 宫头黄经: str(), 宫尾黄经: str(), 跨度: num('宫位跨度（度）') }, '宫位范围'),
  宫内星体: arr(placementSchema, '落在该宫的本命星体与点'),
  宫主星: obj({ ...placementSchema.properties, 传统尊贵: arr(str()) }, '宫头星座的传统守护星及其落点'),
  本命相位: arr(aspectSchema, '该星体参与的本命相位'),
  宫主星相位: arr(aspectSchema, '宫主星参与的本命相位'),
  流运触发: arr(aspectSchema, '流运星体对该星体形成的相位'),
  流运过境: arr(placementSchema, '流运时刻落在该本命宫内的星体'),
  口径: arr(str(), '判定口径说明'),
});
