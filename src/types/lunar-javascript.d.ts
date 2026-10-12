/**
 * lunar-javascript 库的类型声明
 * 
 * lunar-javascript 是一个纯 JavaScript 库，没有官方 TypeScript 类型
 * 这个文件为项目中使用的 API 提供基本类型定义
 */

declare module 'lunar-javascript' {
    /**
     * 公历日期类
     */
    export class Solar {
        /**
         * 从年月日时分秒创建 Solar 对象
         */
        static fromYmdHms(
            year: number,
            month: number,
            day: number,
            hour?: number,
            minute?: number,
            second?: number
        ): Solar;

        /**
         * 从年月日创建 Solar 对象
         */
        static fromYmd(year: number, month: number, day: number): Solar;

        /**
         * 获取农历日期
         */
        getLunar(): Lunar;

        /**
         * 获取年
         */
        getYear(): number;

        /**
         * 获取月
         */
        getMonth(): number;

        /**
         * 获取日
         */
        getDay(): number;

        /**
         * 获取时
         */
        getHour(): number;

        /**
         * 获取分
         */
        getMinute(): number;

        /**
         * 获取指定天数后的日期（负数为之前）
         */
        next(days: number, onlyWorkday?: boolean): Solar;
    }

    /**
     * 农历日期类
     */
    export class Lunar {
        /**
         * 从农历年月日创建 Lunar 对象
         */
        static fromYmd(year: number, month: number, day: number): Lunar;

        /**
         * 从农历年月日时分秒创建 Lunar 对象
         */
        static fromYmdHms(
            year: number,
            month: number,
            day: number,
            hour?: number,
            minute?: number,
            second?: number
        ): Lunar;

        /**
         * 获取公历日期
         */
        getSolar(): Solar;

        /**
         * 获取八字
         */
        getEightChar(): EightChar;

        /**
         * 获取农历年
         */
        getYear(): number;

        /**
         * 获取农历月
         */
        getMonth(): number;

        /**
         * 获取农历日
         */
        getDay(): number;

        /**
         * 获取日干支
         */
        getDayInGanZhi(): string;

        /**
         * 获取年干支（以正月初一为界）
         */
        getYearInGanZhi(): string;

        /**
         * 获取月干支（精确到节气）
         */
        getMonthInGanZhiExact(): string;

        /**
         * 获取节气表
         */
        getJieQiTable(): Record<string, Solar>;

        /**
         * 获取节气列表
         */
        getJieQiList(): string[];

        // ===== 神煞相关 =====

        /**
         * 获取当日吉神宜趋
         */
        getDayJiShen(): string[];

        /**
         * 获取当日凶神宜忌
         */
        getDayXiongSha(): string[];

        /**
         * 获取当日宜
         */
        getDayYi(): string[];

        /**
         * 获取当日忌
         */
        getDayJi(): string[];

        /**
         * 获取年神煞（以年柱计算）
         */
        getYearShenSha(): string[];

        /**
         * 获取月神煞
         */
        getMonthShenSha(): string[];

        // ===== 黄历信息 =====

        /**
         * 获取冲什么生肖
         */
        getChongShengXiao(): string;

        /**
         * 获取冲的描述（如 "冲牛(丁丑)煞西"）
         */
        getChongDesc(): string;

        /**
         * 获取煞方位
         */
        getSha(): string;

        /**
         * 获取天神/值神（如 "玄武"）
         */
        getDayTianShen(): string;

        /**
         * 获取天神类型（黄道/黑道）
         */
        getDayTianShenType(): string;

        /**
         * 获取天神吉凶（吉/凶）
         */
        getDayTianShenLuck(): string;

        /**
         * 获取胎神方位（如 "房床厕 外西北"）
         */
        getDayPositionTai(): string;

        /**
         * 获取财神方位描述
         */
        getDayPositionCaiDesc(): string;

        /**
         * 获取喜神方位描述
         */
        getDayPositionXiDesc(): string;

        /**
         * 获取福神方位描述
         */
        getDayPositionFuDesc(): string;

        /**
         * 获取阳贵神方位描述
         */
        getDayPositionYangGuiDesc(): string;

        /**
         * 获取阴贵神方位描述
         */
        getDayPositionYinGuiDesc(): string;


        /**
         * 获取二十八宿
         */
        getXiu(): string;

        /**
         * 获取二十八宿详情（如 "东宫 亢金 (凶)"）
         */
        getXiuLuck(): string;

        /**
         * 获取宿宫
         */
        getGong(): string;

        /**
         * 获取兽（如 "龙"）
         */
        getShou(): string;

        /**
         * 获取星宿所属七政（如 "土"）
         */
        getZheng(): string;

        /**
         * 获取星宿禽兽（如 "獐"，与七政合称 "土獐"）
         */
        getAnimal(): string;

        /**
         * 获取月相
         */
        getYueXiang(): string;

        /**
         * 获取物候
         */
        getWuHou(): string;

        /**
         * 获取物候索引
         */
        getHou(): string;

        /**
         * 获取六曜
         */
        getLiuYao(): string;

        /**
         * 获取日九星
         */
        getDayNineStar(): NineStar;

        /**
         * 获取空亡（旬空）
         */
        getDayXunKong(): string;

        /**
         * 获取年生肖
         */
        getYearShengXiao(): string;

        /**
         * 获取月生肖
         */
        getMonthShengXiao(): string;

        /**
         * 获取日生肖
         */
        getDayShengXiao(): string;

        /**
         * 获取农历年中文（如 "二〇二六"）
         */
        getYearInChinese(): string;

        /**
         * 获取农历月中文（如 "冬月"）
         */
        getMonthInChinese(): string;

        /**
         * 获取农历日中文（如 "廿一"）
         */
        getDayInChinese(): string;

        /**
         * 获取当前节气
         */
        getJieQi(): string | null;

        /**
         * 获取上一个节气
         */
        getPrevJieQi(): JieQi | null;

        /**
         * 获取下一个节气
         */
        getNextJieQi(): JieQi | null;

        /**
         * 获取当前节令
         */
        getCurrentJie(): JieQi | null;

        /**
         * 获取当前节
         */
        getCurrentQi(): JieQi | null;
    }

    /**
     * 节气类
     */
    export class JieQi {
        /**
         * 获取节气名称
         */
        getName(): string;

        /**
         * 获取节气对应的公历日期
         */
        getSolar(): Solar;
    }

    /**
     * 九星类
     */
    export class NineStar {
        /**
         * 转为字符串（如 "二黑土天璇"）
         */
        toString(): string;

        /**
         * 转为完整字符串
         */
        toFullString(): string;

        /**
         * 获取数字（中文数字，如 "四"）
         */
        getNumber(): string;

        /**
         * 获取颜色
         */
        getColor(): string;

        /**
         * 获取五行
         */
        getWuXing(): string;

        /**
         * 获取方位描述
         */
        getPositionDesc(): string;
    }

    /**
     * 农历月类
     */
    export class LunarMonth {
        /**
         * 从农历年月获取 LunarMonth 对象
         */
        static fromYm(year: number, month: number): LunarMonth;

        /**
         * 获取该月天数
         */
        getDayCount(): number;

        /**
         * 获取农历年
         */
        getYear(): number;

        /**
         * 获取农历月（闰月为负数）
         */
        getMonth(): number;
    }

    /**
     * 农历年类
     */
    export class LunarYear {
        /**
         * 从年份创建 LunarYear 对象
         */
        static fromYear(year: number): LunarYear;

        /**
         * 获取闰月月份（无闰月返回 0）
         */
        getLeapMonth(): number;
    }

    /**
     * 八字类
     */
    export class EightChar {
        /**
         * 获取年柱天干
         */
        getYearGan(): string;

        /**
         * 获取年柱地支
         */
        getYearZhi(): string;

        /**
         * 获取月柱天干
         */
        getMonthGan(): string;

        /**
         * 获取月柱地支
         */
        getMonthZhi(): string;

        /**
         * 获取日柱天干
         */
        getDayGan(): string;

        /**
         * 获取日柱地支
         */
        getDayZhi(): string;

        /**
         * 获取时柱天干
         */
        getTimeGan(): string;

        /**
         * 获取时柱地支
         */
        getTimeZhi(): string;

        /**
         * 获取年柱
         */
        getYear(): string;

        /**
         * 获取月柱
         */
        getMonth(): string;

        /**
         * 获取日柱
         */
        getDay(): string;

        /**
         * 获取时柱
         */
        getTime(): string;

        // ===== 纳音 =====
        getYearNaYin(): string;
        getMonthNaYin(): string;
        getDayNaYin(): string;
        getTimeNaYin(): string;

        // ===== 十二长生 =====
        getYearDiShi(): string;
        getMonthDiShi(): string;
        getDayDiShi(): string;
        getTimeDiShi(): string;

        // ===== 十神（天干） =====
        getYearShiShenGan(): string;
        getMonthShiShenGan(): string;
        getTimeShiShenGan(): string;

        // ===== 十神（地支藏干） =====
        getYearShiShenZhi(): string[];
        getMonthShiShenZhi(): string[];
        getDayShiShenZhi(): string[];
        getTimeShiShenZhi(): string[];

        // ===== 大运 =====
        getYun(gender: number): Yun;
    }

    /**
     * 运类
     */
    export class Yun {
        /**
         * 获取起运年龄
         */
        getStartYear(): number;

        /**
         * 获取精确起运时间
         */
        getStartSolar(): Solar;

        /**
         * 获取大运列表
         */
        getDaYun(): DaYun[];
    }

    /**
     * 大运类
     */
    export class DaYun {
        getStartYear(): number;
        getStartAge(): number;
        getGanZhi(): string;
        getGan(): string;
        getZhi(): string;
        getLiuNian(): LiuNian[];
    }

    /**
     * 流年类
     */
    export class LiuNian {
        getYear(): number;
        getAge(): number;
        getGanZhi(): string;
    }
}
