/** 黄历择日筛选的公开类型：与规范 JSON 的字段同名 */

export interface AlmanacSelectInput {
  /** 区间起始日 YYYY-MM-DD */
  startDate: string;
  /** 区间结束日 YYYY-MM-DD；与起始日跨度不超过 92 天 */
  endDate: string;
  /** 择日事项，如 嫁娶、开市；按黄历宜忌逐条包含匹配 */
  activity?: string;
  /** 需要避冲的生肖（如 牛）或地支（如 丑），可多个（如新人双方） */
  excludeClash?: string[];
  /** IANA 时区，决定逐日黄历的取用时刻，默认 Asia/Shanghai */
  timezone?: string;
}

export interface AlmanacSelectDayJSON {
  日期: string;
  日干支: string;
  农历: string;
  生肖: string;
  建除: string;
  天神: string;
  天神吉凶: string;
  星宿: string;
  星宿吉凶: string;
  纳音: string;
  冲煞: string;
  宜: string[];
  忌: string[];
}

export interface AlmanacSelectSections {
  查询: { 起止日期: string; 天数: number; 事项?: string; 排除冲煞?: string[] };
  候选日: AlmanacSelectDayJSON[];
  排除统计: { 候选数: number; 犯忌: number; 无对应宜: number; 冲煞: number };
  口径: string[];
}

export interface AlmanacSelectOutput {
  sections: AlmanacSelectSections;
  calculationOptions: { timezone: string; ruleVersion: string };
}
