
// ===== 奇门遁甲相关类型 =====

export interface QimenInput {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute?: number;
  timezone?: string;
  question?: string;
  panType?: 'zhuan' | 'fei';
  juMethod?: 'chaibu' | 'maoshan' | 'equal';
  flyStarMethod?: 'forward' | 'yin-reverse';
  juNumber?: number;
  dunType?: 'yang' | 'yin';
  zhiFuJiGong?: 'ji_liuyi' | 'ji_wugong';
}

export interface QimenPalaceInfo {
  palaceIndex: number;        // 宫位序号 1-9
  palaceName: string;         // 卦名（坎、坤、震...）
  direction: string;          // 方位
  element: string;            // 宫五行
  earthStem: string;          // 地盘天干
  heavenStem: string;         // 天盘天干
  star: string;               // 九星
  starElement: string;        // 星五行
  gate: string;               // 八门
  gateElement: string;        // 门五行
  deity: string;              // 八神
  formations: string[];       // 该宫格局列表
  stemWangShuai?: string;     // 天干旺衰状态
  elementState?: string;      // 宫五行旺衰
  earthStemElement?: string;  // 地盘干五行
  heavenStemElement?: string; // 天盘干五行
  isKongWang?: boolean;       // 是否空亡
  isYiMa?: boolean;           // 是否驿马
  isRuMu?: boolean;           // 是否入墓
  ruMuStems?: string[];       // 在本宫入墓的天盘干；乙在坤二另标“乙(五行墓)”
  isMenPo?: boolean;
  isJiXing?: boolean;
  hostedStars?: string[];
  hostedHeavenStems?: string[];
  hostedEarthStems?: string[];
}

export interface QimenOutput {
  dateInfo: {
    solarDate: string;
    lunarDate: string;
    solarTerm: string;
    solarTermRange?: string;
  };
  siZhu: {
    year: string;
    month: string;
    day: string;
    hour: string;
  };
  dunType: 'yang' | 'yin';
  juNumber: number;
  yuan: string;
  xunShou: string;
  zhiFu: { star: string; palace: number; };
  zhiShi: { gate: string; palace: number; };
  palaces: QimenPalaceInfo[];
  kongWang: {
    dayKong: { branches: string[]; palaces: number[]; };
    hourKong: { branches: string[]; palaces: number[]; };
  };
  yiMa: { branch: string; palace: number; };
  /** 全局格局：全盘格局以“全盘: ”开头列一次，其余为“某宫: 格局” */
  globalFormations: string[];
  /** 全盘格局（星门伏吟反吟、五不遇时、时干入墓）；旧版本输出可能缺失 */
  boardFormations?: string[];
  panType: string;
  juMethod: string;
  question?: string;
  monthPhase?: Record<string, string>; // 十干月令旺衰：干 → 旺/相/休/囚/死
  inputSnapshot?: QimenInput & { timezone: string; panType: 'zhuan' | 'fei'; juMethod: 'chaibu' | 'maoshan' | 'equal'; ruleVersion: string };
}
