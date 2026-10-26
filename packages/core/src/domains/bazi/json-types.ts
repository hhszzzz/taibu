import type {
  DayunItemJSON,
  HiddenStemJSON,
  TrueSolarTimeJSON
} from '../shared/json-types.js';

export interface BaziCanonicalJSON {
  计算规则?: Record<string, unknown>;
  基本信息: {
    性别: string;
    日主: string;
    命主五行?: string;
    空亡?: string[];
    出生地?: string;
    真太阳时?: TrueSolarTimeJSON;
    胎元?: string;
    命宫?: string;
    /** 只在出生时辰未知时出现；此时四柱只有年、月、日三柱 */
    出生时辰?: string;
  };
  四柱: BaziPillarJSON[];
  干支关系: string[];
  /** Exact calculation coordinates; optional for previously persisted charts. */
  干支关系明细?: BaziRelationJSON[];
  大运?: {
    起运信息: string;
    大运列表: DayunItemJSON[];
  };
}

export interface BaziCellJSON {
  柱: '年柱' | '月柱' | '日柱' | '时柱';
  部位: '天干' | '地支';
  字: string;
}

export interface BaziRelationJSON {
  id: string;
  类型: string;
  说明: string;
  位置: BaziCellJSON[];
}

// ===== 八字 =====

export interface BaziPillarJSON {
  柱: string;
  干支: string;
  天干十神: string;
  藏干: HiddenStemJSON[];
  地势: string;
  纳音?: string;
  神煞?: string[];
  空亡?: '是';
}
