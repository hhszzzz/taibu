import type {
  DerivedHexagramJSON,
  LiuyaoCombinationJSON,
} from '../shared/json-types.js';

export interface LiuyaoJSON {
  卦盘: {
    问题?: string;
    本卦: {
      卦名: string;
      卦宫: string;
      五行: string;
      卦辞?: string;
    };
    变卦?: {
      卦名: string;
      卦宫?: string;
      五行?: string;
      卦辞?: string;
      动爻?: string[];
      动爻爻辞?: Array<{
        爻名: string;
        爻辞: string;
      }>;
    };
    干支时间: Array<{
      柱: string;
      干支: string;
      空亡: string[];
    }>;
    卦身?: {
      地支: string;
      位置?: string;
      状态?: string;
    };
    衍生卦?: {
      互卦?: { 卦名: string; };
      错卦?: { 卦名: string; };
      综卦?: { 卦名: string; };
    };
    全局神煞?: string[];
  };
  六爻全盘: {
    爻列表: LiuyaoBoardLineJSON[];
  };
  全局互动: {
    组合关系: LiuyaoCombinationJSON[];
    冲合转换?: LiuyaoTransitionJSON[];
    反伏信息?: LiuyaoResonanceJSON[];
    是否六冲卦?: '是' | '否';
    是否六合卦?: '是' | '否';
    冲合趋势?: '冲转合' | '合转冲';
  };
  元信息: {
    细节级别: '默认' | '扩展' | '完整';
  };
}

export interface LiuyaoLineJSON {
  position?: string;
  liuQin: string;
  naJia?: string;
  wuXing?: string;
  shiYing?: 'shi' | 'ying';
  shenSha?: string[];
  wangShuai?: string;
  movement?: string;
  kongWang?: string;
  changedTo?: {
    liuQin: string;
    naJia: string;
    wuXing: string;
  };
  transformation?: string;
}

export interface LiuyaoBoardLineJSON {
  爻位: string;
  六神: string;
  神煞?: string[];
  伏神?: {
    六亲: string;
    纳甲: string;
    五行: string;
  };
  本爻: {
    六亲: string;
    纳甲: string;
    五行: string;
    旺衰?: string;
  };
  动静?: string;
  空亡?: string;
  变爻?: {
    六亲: string;
    纳甲: string;
    五行: string;
  };
  化变?: string;
  世应?: '世' | '应';
}

export interface LiuyaoTransitionJSON {
  类型: '冲转合' | '合转冲';
}

export interface LiuyaoResonanceJSON {
  类型: '反吟' | '伏吟';
  /** 所在之卦；旧排盘未记录时省略 */
  范围?: '内卦' | '外卦' | '内外卦';
}

export type LiuyaoAISafeJSON = LiuyaoJSON;
export type LiuyaoAISafeLineJSON = LiuyaoLineJSON;
export type LiuyaoAISafeBoardLineJSON = LiuyaoBoardLineJSON;
export type LiuyaoAISafeTransitionJSON = LiuyaoTransitionJSON;
export type LiuyaoAISafeResonanceJSON = LiuyaoResonanceJSON;

export interface LiuyaoCanonicalJSON {
  计算规则?: Record<string, unknown>;
  卦盘: {
    问题?: string;
    本卦: {
      卦名: string;
      卦宫: string;
      五行: string;
      卦辞?: string;
      象辞?: string;
    };
    变卦?: {
      卦名: string;
      卦宫?: string;
      五行?: string;
      卦辞?: string;
      象辞?: string;
      动爻爻辞?: Array<{ 爻名: string; 爻辞: string; }>;
    };
    互卦?: DerivedHexagramJSON;
    错卦?: DerivedHexagramJSON;
    综卦?: DerivedHexagramJSON;
    卦身?: {
      地支: string;
      位置?: string;
      状态?: string;
    };
  };
  干支时间: Array<{
    柱: string;
    干支: string;
    空亡: string[];
  }>;
  六爻: LiuyaoYaoJSON[];
  用神分析: LiuyaoYongShenJSON[];
  卦级分析: string[];
  提示: string[];
  全局神煞?: string[];
}

export interface LiuyaoYaoJSON {
  爻位: string;
  世应?: string;
  六亲: string;
  六神: string;
  纳甲: string;
  五行: string;
  旺衰: string;
  动静状态?: string;
  动静: string;
  空亡?: string;
  /** 本爻在日辰实际作用的长生/帝旺/墓/绝（「论生不论墓」等被否定者与其余八位不输出） */
  长生?: string;
  神煞?: string[];
  变爻?: {
    六亲: string;
    纳甲: string;
    五行: string;
    关系: string;
  };
  伏神?: {
    六亲: string;
    纳甲: string;
    五行: string;
    关系: string;
  };
}

export interface LiuyaoYongShenJSON {
  目标六亲: string;
  取用状态: string;
  取用说明?: string;
  已选用神: {
    爻位?: string;
    六亲: string;
    纳甲?: string;
    变爻纳甲?: string;
    化变类型?: string;
    五行?: string;
    来源?: string;
    动静状态?: string;
    是否世爻?: '是';
    是否应爻?: '是';
    空亡状态?: string;
    强弱: string;
    动静: string;
    依据?: string[];
  };
  候选用神?: Array<{
    爻位?: string;
    六亲: string;
    纳甲?: string;
    变爻纳甲?: string;
    化变类型?: string;
    五行?: string;
    来源?: string;
    动静状态?: string;
    是否世爻?: '是';
    是否应爻?: '是';
    空亡状态?: string;
    强弱: string;
    动静: string;
    依据?: string[];
  }>;
  神煞系统?: {
    原神?: string;
    忌神?: string;
    仇神?: string;
  };
  应期提示?: Array<{
    /** 应期为关键之期，吉期为转吉之期，忌期为须防之期；旧快照可能缺省 */
    类型?: '应期' | '吉期' | '忌期';
    触发: string;
    依据: string[];
    说明: string;
  }>;
}
