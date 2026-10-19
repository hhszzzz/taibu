import { arr, num, obj, type OutputSchema, str } from '../../schema-builders.js';
import { ganzhiRelationRowSchema } from '../bazi-relations/output-schema.js';

export const baziWuxingOutputSchema: OutputSchema = obj({
  日主: obj({ 天干: str('日主天干'), 五行: str('日主五行') }, '日主天干及其五行'),
  五行统计: arr(obj({
    五行: str('五行'), 天干: num('天干个数'), 地支: num('地支本气个数'), 藏干: num('藏干加权数（0.6/0.3/0.1）'), 合计: num('加权合计'),
  }), '五行加权统计（木火土金水）'),
  缺失五行: arr(str(), '合计为 0 的五行'),
  月令: obj({
    月支: str('月支'), 月令五行: str('月支五行（辰戌丑未为土）'),
    旺: str('当旺五行'), 相: str('相的五行'), 休: str('休的五行'), 囚: str('囚的五行'), 死: str('死的五行'),
    日主状态: str('日主在月令的旺相休囚死'),
  }, '月令旺相休囚死'),
  通根: arr(ganzhiRelationRowSchema, '日主在地支藏干中的同五行之根'),
  透干: arr(ganzhiRelationRowSchema, '地支藏干原字见于天干'),
  干支自坐: arr(ganzhiRelationRowSchema, '各柱天干与地支本气的生克'),
  相邻天干: arr(ganzhiRelationRowSchema, '年月、月日、日时天干的生克'),
  相生链: obj({
    顺序: str('相生顺序'), 出现: arr(str(), '出现的五行（含藏干）'), 连续段: arr(str(), '连续相生的五行段'), 中断: arr(str(), '因缺失五行而中断之处'),
  }, '五行相生链'),
  十神分布: arr(obj({ 十神: str('十神'), 天干: arr(str(), '透于天干的位置'), 藏干: arr(str(), '藏于地支的位置') }), '十神在天干与藏干中的分布'),
  口径: arr(str(), '判定口径说明'),
});
