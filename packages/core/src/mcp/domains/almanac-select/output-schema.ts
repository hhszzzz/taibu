import { arr, num, obj, type OutputSchema, str } from '../../schema-builders.js';

const daySchema = obj({
  日期: str('公历日期'),
  日干支: str('当日干支'),
  农历: str('对应农历日期'),
  生肖: str('值年生肖'),
  建除: str('建除十二神'),
  天神: str('黄黑道十二神与类型'),
  天神吉凶: str('天神吉凶（吉/凶）'),
  星宿: str('值日星宿（二十八宿）'),
  星宿吉凶: str('星宿吉凶（吉/凶）'),
  纳音: str('日柱纳音五行'),
  冲煞: str('冲煞（所冲干支、生肖与煞方）'),
  宜: arr(str(), '宜做事项'),
  忌: arr(str(), '忌做事项'),
});

export const almanacSelectOutputSchema: OutputSchema = obj({
  查询: obj({
    起止日期: str('区间起止日期'),
    天数: num('区间天数（含首尾）'),
    事项: str('本次筛选的择日事项'),
    排除冲煞: arr(str(), '本次需要避冲的地支与生肖（按地支顺序），各附其所冲'),
  }, '本次筛选条件'),
  候选日: arr(daySchema, '区间内命中条件的日子'),
  排除统计: obj({
    候选数: num('命中条件的日数'),
    犯忌: num('因事项落在忌而排除的日数'),
    无对应宜: num('宜忌均未提到该事项而排除的日数'),
    冲煞: num('因避冲而排除的日数'),
  }, '排除统计'),
  口径: arr(str(), '判定口径说明'),
});
