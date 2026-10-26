import { arr, bool, num, obj, type OutputSchema, str } from '../../schema-builders.js';
import { ganzhiRelationRowSchema } from '../bazi-relations/output-schema.js';

const pillarRowSchema = obj({ 柱: str('柱名'), 干支: str('干支') });

export const baziHourCandidatesOutputSchema: OutputSchema = obj({
  出生日期: obj({
    公历: str('出生当天的公历日期'),
    农历: str('出生当天的农历日期'),
    性别: str('性别'),
    时区: str('钟表时间所在的 IANA 时区'),
    经度: num('出生地经度；给出时按真太阳时定日柱与时柱'),
  }, '出生日期'),
  共有柱: arr(pillarRowSchema, '所列候选共有的柱（通常为年、月、日三柱）'),
  日主: str('日柱共有时的日主天干及五行'),
  当天交节: str('出生当天交节：节气、交节时刻与交节后的起始钟表时间'),
  钟表时段: str('给了 fromHour、toHour 时的钟表时段'),
  候选数量: num('所列候选时辰的个数'),
  候选: arr(obj({
    序号: num('候选序号（从1开始）'),
    时辰: str('时辰名（早子时、丑时……晚子时；同一时辰被交节或日界分成两段时注明是哪一段）'),
    钟表时间: obj({
      开始: str('开始的钟表时间（含）'),
      结束: str('结束的钟表时间（不含）'),
      结束不含: bool('结束时刻不属于本候选'),
      分钟数: num('时段长度（分钟）'),
    }, '本候选的钟表时段'),
    真太阳时: obj({ 开始: str('开始的真太阳时'), 结束: str('结束的真太阳时') }, '给了经度时对应的真太阳时'),
    四柱: arr(pillarRowSchema, '本候选的四柱'),
    时柱: obj({
      干支: str('时柱干支'),
      天干十神: str('时干相对日主的十神'),
      藏干: arr(obj({ 天干: str('藏干'), 十神: str('藏干十神'), 气性: str('气性') }), '时支藏干'),
      地势: str('日主在时支的十二长生'),
      纳音: str('时柱纳音'),
      神煞: arr(str(), '时柱神煞'),
      空亡: str('时支落空亡时为「是」'),
    }, '时柱'),
    时柱关系: arr(ganzhiRelationRowSchema, '时柱参与的原局干支关系'),
    命宫: str('命宫干支'),
    日主之根: str('日主在时支有无根'),
    月令透时干: arr(str(), '透于时干的月令藏干'),
    缺失五行: arr(str(), '天干、地支本气与藏干都没有出现的五行'),
    起运: str('起运时间（按排盘参数的时刻）'),
    首步大运: obj({ 干支: str('首步大运干支'), 起运年份: num('首步大运起运年份'), 起运年龄: num('首步大运起运年龄（虚岁）') }, '首步大运'),
    排盘参数: obj({
      出生时: num('确认后排盘用的 birthHour'),
      出生分: num('确认后排盘用的 birthMinute'),
      夏令时策略: str('钟表时间因夏令时出现两次时排盘用的 disambiguation'),
    }, '确认这个时辰后正式排盘用的出生时间'),
    前事: arr(obj({
      年份: num('前事年份'),
      流年: str('流年干支'),
      大运: str('这一年所在的大运（起运前为小运）'),
      关系: arr(ganzhiRelationRowSchema, '区分各候选的岁运关系'),
      岁运提示: arr(str(), '涉及区分柱位的伏吟、天克地冲'),
    }), '给了前事年份时各年区分各候选的事实'),
  }), '候选时辰'),
  前事年份: arr(obj({ 年份: num('前事年份'), 流年: str('流年干支') }), '给出的前事年份'),
  口径: arr(str(), '判定口径说明'),
});
