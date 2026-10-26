/**
 * CanonicalJSON 输出类型定义
 * 与 text.ts 的 render*CanonicalText() 平行，提供结构化 JSON 输出。
 */

// ===== 共用子类型 =====

export interface TrueSolarTimeJSON {
  钟表时间: string;
  真太阳时: string;
  经度: number;
  校正分钟: number;
}

export interface HiddenStemJSON {
  天干: string;
  十神: string;
  气性?: string;
}

export interface BranchRelationJSON {
  类型: string;
  地支: string[];
  描述: string;
}

export interface LiunianItemJSON {
  流年: number;
  年龄: number;
  干支: string;
  天干: string;
  地支: string;
  十神: string;
  纳音?: string;
  藏干: HiddenStemJSON[];
  地势?: string;
  神煞?: string[];
  原局关系?: BranchRelationJSON[];
  太岁关系?: string[];
}

export interface DayunItemJSON {
  起运年份: number;
  起运年龄?: number;
  /** 出生时辰未知、时辰偏晚时这一步大运的交运年份与年龄（晚一年） */
  最晚起运年份?: number;
  最晚起运年龄?: number;
  干支: string;
  天干?: string;
  地支?: string;
  十神: string;
  地支主气十神?: string;
  藏干: HiddenStemJSON[];
  地势?: string;
  纳音?: string;
  神煞?: string[];
  原局关系?: BranchRelationJSON[];
  流年列表?: LiunianItemJSON[];
}

// ===== 六爻 =====

export interface DerivedHexagramJSON {
  卦名: string;
  卦辞?: string;
  象辞?: string;
}

export interface LiuyaoCombinationJSON {
  类型: '半合' | '三合';
  结果五行: string;
  参与者?: LiuyaoParticipantJSON[];
  名称?: string;
  位置?: string[];
}

export interface LiuyaoParticipantJSON {
  来源: '动爻' | '变爻' | '月建' | '日建';
  地支: string;
  位置?: string;
}

export type LiuyaoAISafeCombinationJSON = LiuyaoCombinationJSON;
export type LiuyaoAISafeParticipantJSON = LiuyaoParticipantJSON;

// ===== 紫微 =====

export interface ZiweiStarJSON {
  星名: string;
  亮度?: string;
  四化?: string;
  离心自化?: string;
  向心自化?: string;
}

export interface ZiweiBirthYearMutagenJSON {
  四化: '禄' | '权' | '科' | '忌';
  星曜: string;
  宫位: string;
}

// ===== 紫微飞星 =====

export interface ZiweiFlyingStarResultJSON {
  查询序号: number;
  查询类型: string;
  判断目标?: string;
  结果?: '是' | '否';
  发射宫位?: string;
  发射宫干支?: string;
  实际飞化?: Array<{ 四化: string; 宫位: string | null; 星曜?: string | null; }>;
  四化落宫?: Array<{ 四化: string; 宫位: string | null; 星曜?: string | null; }>;
  本宫?: string;
  矩阵宫位?: { 对宫: string; 三合1: string; 三合2: string; };
}
