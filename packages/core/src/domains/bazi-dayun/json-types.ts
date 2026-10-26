import type {
  DayunItemJSON
} from '../shared/json-types.js';

// ===== 大运 =====

export interface DayunCanonicalJSON {
  计算规则?: Record<string, unknown>;
  起运信息: {
    起运时刻?: string;
    时区?: string;
    顺逆?: string;
    起运年龄: number;
    起运详情: string;
    /** 出生时辰未知时：时辰最晚的起运时刻，与交运年份是否可能推迟 */
    最晚起运时刻?: string;
    交运年份?: string;
  };
  小运?: Array<{
    年龄: number;
    干支: string;
    十神: string;
  }>;
  大运列表: DayunItemJSON[];
}
