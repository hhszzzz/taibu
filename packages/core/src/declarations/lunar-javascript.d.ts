/**
 * lunar-javascript 库的类型声明
 */

declare module 'lunar-javascript' {
  export class Solar {
    static fromDate(date: Date): Solar;
    static fromYmd(year: number, month: number, day: number): Solar;
    static fromYmdHms(
      year: number,
      month: number,
      day: number,
      hour?: number,
      minute?: number,
      second?: number
    ): Solar;
    getLunar(): Lunar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getHour(): number;
    getMinute(): number;
    getSecond(): number;
    toYmd(): string;
    toYmdHms(): string;
    next(days: number, onlyWorkday?: boolean): Solar;
  }

  export class Lunar {
    static fromYmd(year: number, month: number, day: number): Lunar;
    static fromYmdHms(
      year: number,
      month: number,
      day: number,
      hour?: number,
      minute?: number,
      second?: number
    ): Lunar;
    getEightChar(): EightChar;
    getSolar(): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    toString(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getYearInChinese(): string;
    getYearShengXiao(): string;
    getMonthShengXiao(): string;
    getDayShengXiao(): string;
    getJieQi(): string | null;
    getPrevJieQi(): JieQi | null;
    getPrevQi(wholeDay?: boolean): JieQi;
    getNextJieQi(): JieQi | null;
    getCurrentJie(): JieQi | null;
    getCurrentQi(): JieQi | null;
    getJieQiTable(): Record<string, Solar>;
    getJieQiList(): string[];
    getDayInGanZhi(): string;
    getYearInGanZhi(): string;
    /** 以立春日换年的年干支（getMonthInGanZhi 的月干即据此推算） */
    getYearInGanZhiByLiChun(): string;
    getMonthInGanZhi(): string;
    getTimeInGanZhi(): string;
    getMonthInGanZhiExact(): string;
    // 黄历相关
    getDayYi(): string[];
    getDayJi(): string[];
    getDayJiShen(): string[];
    getDayXiongSha(): string[];
    getYearShenSha(): string[];
    getMonthShenSha(): string[];
    getChongShengXiao(): string;
    getChongDesc(): string;
    getDayChongDesc(): string;
    getSha(): string;
    getDaySha(): string;
    getPengZuGan(): string[];
    getPengZuZhi(): string[];
    getDayTianShen(): string;
    getDayTianShenType(): string;
    getDayTianShenLuck(): string;
    getDayPositionTai(): string;
    getDayPositionCaiDesc(): string;
    getDayPositionXiDesc(): string;
    getDayPositionFuDesc(): string;
    getDayPositionYangGuiDesc(): string;
    getDayPositionYinGuiDesc(): string;
    getXiu(): string;
    getXiuLuck(): string;
    getGong(): string;
    getShou(): string;
    getZheng(): string;
    getYueXiang(): string;
    getWuHou(): string;
    getHou(): string;
    getLiuYao(): string;
    getDayNineStar(): NineStar;
    getYearNineStar(sect?: number): NineStar;
    getMonthNineStar(sect?: number): NineStar;
    getTimeNineStar(): NineStar;
    getDayXunKong(): string;
    // 建除十二值星
    getZhiXing(): string;
    // 日柱纳音
    getDayNaYin(): string;
    // 二十八星宿歌诀
    getXiuSong(): string;
    // 二十八星宿动物
    getAnimal(): string;
    // 十二时辰
    getTimes(): LunarTime[];
  }

  export class LunarTime {
    getGan(): string;
    getZhi(): string;
    getGanZhi(): string;
    getTianShen(): string;
    getTianShenType(): string;
    getTianShenLuck(): string;
    getChong(): string;
    getChongDesc(): string;
    getSha(): string;
    getYi(): string[];
    getJi(): string[];
    getNaYin(): string;
    getMinHm(): string;
    getMaxHm(): string;
    getShengXiao(): string;
    getPositionCaiDesc(): string;
    getPositionXiDesc(): string;
    getPositionFuDesc(): string;
    getPositionYangGuiDesc(): string;
    getPositionYinGuiDesc(): string;
  }

  export class JieQi {
    getName(): string;
    getSolar(): Solar;
  }

  export class NineStar {
    static fromIndex(index: number): NineStar;
    toString(): string;
    toFullString(): string;
    getNumber(): number;
    getColor(): string;
    getWuXing(): string;
    getPosition(): string;
    getPositionDesc(): string;
    getNameInXuanKong(): string;
    getNameInBeiDou(): string;
    getNameInQiMen(): string;
    getNameInTaiYi(): string;
    getLuckInQiMen(): string;
    getLuckInXuanKong(): string;
    getYinYangInQiMen(): string;
    getTypeInTaiYi(): string;
    getBaMenInQiMen(): string;
    getSongInTaiYi(): string;
    getIndex(): number;
  }

  export class LunarMonth {
    static fromYm(year: number, month: number): LunarMonth;
    getDayCount(): number;
    getYear(): number;
    getMonth(): number;
  }

  export class LunarYear {
    static fromYear(year: number): LunarYear;
    getLeapMonth(): number;
  }

  export class EightChar {
    getYearGan(): string;
    getYearZhi(): string;
    getMonthGan(): string;
    getMonthZhi(): string;
    getDayGan(): string;
    getDayZhi(): string;
    getTimeGan(): string;
    getTimeZhi(): string;
    getYear(): string;
    getMonth(): string;
    getDay(): string;
    getTime(): string;
    getYearNaYin(): string;
    getMonthNaYin(): string;
    getDayNaYin(): string;
    getTimeNaYin(): string;
    getYearDiShi(): string;
    getMonthDiShi(): string;
    getDayDiShi(): string;
    getTimeDiShi(): string;
    getYearShiShenGan(): string;
    getMonthShiShenGan(): string;
    getTimeShiShenGan(): string;
    getYearShiShenZhi(): string[];
    getMonthShiShenZhi(): string[];
    getDayShiShenZhi(): string[];
    getTimeShiShenZhi(): string[];
    setSect(sect: number): void;
    getYun(gender: number, sect?: number): Yun;
  }

  export class Yun {
    getStartYear(): number;
    getStartMonth(): number;
    getStartDay(): number;
    getStartHour(): number;
    isForward(): boolean;
    getStartSolar(): Solar;
    getDaYun(): DaYun[];
  }

  export class DaYun {
    getStartAge(): number;
    getStartYear(): number;
    getGanZhi(): string;
    getGan(): string;
    getZhi(): string;
    getLiuNian(): LiuNian[];
  }

  export class LiuNian {
    getYear(): number;
    getAge(): number;
    getGanZhi(): string;
  }
}
