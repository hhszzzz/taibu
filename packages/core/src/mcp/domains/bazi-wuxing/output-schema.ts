import { arr, obj, type OutputSchema, str } from '../../schema-builders.js';
import { ganzhiRelationRowSchema } from '../bazi-relations/output-schema.js';

const rootRowSchema = obj({
  ...ganzhiRelationRowSchema.properties,
  藏干: str('地支里与该天干同五行的藏干'),
  结果: str('本气、中气或余气'),
}, '一条通根：位置为天干与它所根的地支');

export const baziWuxingOutputSchema: OutputSchema = obj({
  日主: obj({ 天干: str('日主天干'), 五行: str('日主五行') }, '日主天干及其五行'),
  月令: obj({
    月支: str('月支'), 月令五行: str('月支五行（辰戌丑未为土）'),
    旺: str('当旺五行'), 相: str('相的五行'), 休: str('休的五行'), 囚: str('囚的五行'), 死: str('死的五行'),
    日主状态: str('日主在月令的旺相休囚死'),
    藏干: arr(obj({ 天干: str('月令藏干'), 气性: str('本气、中气或余气'), 透出: arr(str(), '透出的天干位置（年干、月干、时干），空为不透') }), '月令各藏干的透出'),
  }, '月令旺相休囚死与藏干透出'),
  缺失五行: arr(str(), '天干、地支本气、藏干都没有出现的五行'),
  筛选: obj({ 事实组: arr(str(), '本次所取的事实组') }, '给出 sections 时所取的事实组'),
  通根: arr(rootRowSchema, '四个天干在地支藏干中的同五行之根，日主在前'),
  无根: arr(str(), '没有同五行藏干的天干'),
  干支自坐: arr(ganzhiRelationRowSchema, '各柱天干与地支本气的生克'),
  相邻天干: arr(ganzhiRelationRowSchema, '年月、月日、日时天干的生克'),
  口径: arr(str(), '判定口径说明'),
});
