/**
 * 黄历/日历数据获取库
 * 
 * 封装 lunar-javascript 库，提供完整的黄历信息
 */

import { Solar } from 'lunar-javascript';

// ===== 类型定义 =====

export interface CalendarAlmanacData {
    // 基础日期信息
    solarDate: string;           // 公历日期 YYYY-MM-DD
    solarDateChinese: string;    // 公历日期中文（如 "2026年1月9日"）
    weekday: string;             // 星期几
    lunarDate: string;           // 农历日期（如 "二〇二五年冬月廿一"）
    lunarMonthDay: string;       // 农历月日（如 "冬月廿一"）

    // 生肖
    shengXiao: {
        year: string;            // 年生肖
        month: string;           // 月生肖
        day: string;             // 日生肖
    };

    // 干支
    ganZhi: {
        year: string;            // 年柱
        month: string;           // 月柱
        day: string;             // 日柱
        time: string;            // 时柱（可选，基于当前时间）
    };

    // 纳音
    naYin: {
        year: string;
        month: string;
        day: string;
    };

    // 节气
    jieQi: {
        current: {
            name: string;
            date: string;        // YYYY-MM-DD
            time: string;        // HH:mm:ss
        } | null;
        next: {
            name: string;
            date: string;
            time: string;
        } | null;
    };

    // 宜忌
    yi: string[];                // 今日宜
    ji: string[];                // 今日忌

    // 吉神凶煞
    jiShen: string[];            // 吉神宜趋
    xiongSha: string[];          // 凶神宜忌

    // 冲煞信息
    chongSha: {
        chong: string;           // 冲什么（如 "羊日冲(丁丑)牛"）
        sha: string;             // 煞方位
    };

    // 空亡
    kongWang: string;

    // 胎神
    taiShen: string;

    // 值神（天神）
    zhiShen: string;

    // 神位
    shenWei: {
        caiShen: string;         // 财神位
        xiShen: string;          // 喜神位
        fuShen: string;          // 福神位
        yangGuiShen: string;     // 阳贵神
    };

    // 二十八宿
    xiu: {
        name: string;            // 宿名
        gong: string;            // 宫位
        luck: string;            // 吉凶
        animal: string;          // 七政 + 禽兽（如 "土獐"，即柳土獐）
    };

    // 月相
    yueXiang: string;

    // 六曜
    liuYao: string;

    // 九星
    jiuXing: string;

    // 日九星：星名（数 + 色 + 五行，如 "四绿木"）与所在方位（如 "东南"）
    nineStar: {
        name: string;
        position: string;
    };

    // 物候
    wuHou: string;

    // 物候分解：三候序（如 "寒露初候"）与候应（如 "鸿雁来宾"）
    hou: {
        term: string;
        phenology: string;
    };
}

// ===== 主要函数 =====

/**
 * 获取指定日期的完整黄历信息
 */
export function getCalendarAlmanac(date: Date): CalendarAlmanacData {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    const eightChar = lunar.getEightChar();

    // 格式化公历日期
    const solarDateChinese = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[date.getDay()];

    // 农历信息
    const lunarYearChinese = lunar.getYearInChinese();
    const lunarMonthChinese = lunar.getMonthInChinese();
    const lunarDayChinese = lunar.getDayInChinese();

    // 节气信息
    let currentJieQi: CalendarAlmanacData['jieQi']['current'] = null;
    let nextJieQi: CalendarAlmanacData['jieQi']['next'] = null;

    try {
        // 获取前一个节气和下一个节气
        const prevJq = lunar.getPrevJieQi();
        const nextJq = lunar.getNextJieQi();

        // 检查今天是否就是节气当天
        // 如果下一个节气的日期是今天，且当前时间已过节气时间点，则下一个节气应该变成当前节气
        if (nextJq) {
            const jqSolar = nextJq.getSolar();
            const jqDate = `${jqSolar.getYear()}-${String(jqSolar.getMonth()).padStart(2, '0')}-${String(jqSolar.getDay()).padStart(2, '0')}`;
            const todayStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

            // 如果节气日期是今天
            if (jqDate === todayStr) {
                // 比较时间：传入的日期时间是否已过节气时刻
                // 注意：如果传入日期不是今天，则默认认为已过节气时刻（因为无法获取具体时间）
                const isToday = todayStr === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
                const jqHour = jqSolar.getHour();
                const jqMinute = jqSolar.getMinute();
                const jqMinutes = jqHour * 60 + jqMinute;

                // 如果是今天，比较当前时间；如果是查看历史/未来日期，默认认为该日期已过节气时刻
                const currentMinutes = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : 24 * 60;

                if (currentMinutes >= jqMinutes) {
                    // 已过节气时刻，nextJq 应该成为当前节气
                    currentJieQi = {
                        name: nextJq.getName(),
                        date: jqDate,
                        time: `${String(jqHour).padStart(2, '0')}:${String(jqMinute).padStart(2, '0')}:00`,
                    };
                    // 获取下下个节气：从当前节气日期后1天计算其"下一个节气"
                    try {
                        const futureDate = new Date(jqSolar.getYear(), jqSolar.getMonth() - 1, jqSolar.getDay() + 1);
                        const futureSolar = Solar.fromYmd(futureDate.getFullYear(), futureDate.getMonth() + 1, futureDate.getDate());
                        const futureLunar = futureSolar.getLunar();
                        const nextNextJq = futureLunar.getNextJieQi();
                        if (nextNextJq) {
                            const nnSolar = nextNextJq.getSolar();
                            nextJieQi = {
                                name: nextNextJq.getName(),
                                date: `${nnSolar.getYear()}-${String(nnSolar.getMonth()).padStart(2, '0')}-${String(nnSolar.getDay()).padStart(2, '0')}`,
                                time: `${String(nnSolar.getHour()).padStart(2, '0')}:${String(nnSolar.getMinute()).padStart(2, '0')}:00`,
                            };
                        }
                    } catch { /* ignore */ }
                } else {
                    // 尚未到节气时刻
                    if (prevJq) {
                        const prevSolar = prevJq.getSolar();
                        currentJieQi = {
                            name: prevJq.getName(),
                            date: `${prevSolar.getYear()}-${String(prevSolar.getMonth()).padStart(2, '0')}-${String(prevSolar.getDay()).padStart(2, '0')}`,
                            time: `${String(prevSolar.getHour()).padStart(2, '0')}:${String(prevSolar.getMinute()).padStart(2, '0')}:00`,
                        };
                    }
                    nextJieQi = {
                        name: nextJq.getName(),
                        date: jqDate,
                        time: `${String(jqHour).padStart(2, '0')}:${String(jqMinute).padStart(2, '0')}:00`,
                    };
                }
            } else {
                // 节气不是今天，使用常规逻辑
                if (prevJq) {
                    const prevSolar = prevJq.getSolar();
                    currentJieQi = {
                        name: prevJq.getName(),
                        date: `${prevSolar.getYear()}-${String(prevSolar.getMonth()).padStart(2, '0')}-${String(prevSolar.getDay()).padStart(2, '0')}`,
                        time: `${String(prevSolar.getHour()).padStart(2, '0')}:${String(prevSolar.getMinute()).padStart(2, '0')}:00`,
                    };
                }
                const jqSolar2 = nextJq.getSolar();
                nextJieQi = {
                    name: nextJq.getName(),
                    date: `${jqSolar2.getYear()}-${String(jqSolar2.getMonth()).padStart(2, '0')}-${String(jqSolar2.getDay()).padStart(2, '0')}`,
                    time: `${String(jqSolar2.getHour()).padStart(2, '0')}:${String(jqSolar2.getMinute()).padStart(2, '0')}:00`,
                };
            }
        } else if (prevJq) {
            const prevSolar = prevJq.getSolar();
            currentJieQi = {
                name: prevJq.getName(),
                date: `${prevSolar.getYear()}-${String(prevSolar.getMonth()).padStart(2, '0')}-${String(prevSolar.getDay()).padStart(2, '0')}`,
                time: `${String(prevSolar.getHour()).padStart(2, '0')}:${String(prevSolar.getMinute()).padStart(2, '0')}:00`,
            };
        }
    } catch { /* ignore */ }

    // 安全获取各类信息
    const safeGet = <T>(fn: () => T, defaultValue: T): T => {
        try { return fn() ?? defaultValue; } catch { return defaultValue; }
    };

    const safeGetArray = (fn: () => string[]): string[] => {
        try { return fn() || []; } catch { return []; }
    };

    return {
        // 基础日期
        solarDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        solarDateChinese,
        weekday,
        lunarDate: `${lunarYearChinese}年${lunarMonthChinese}月${lunarDayChinese}`,
        lunarMonthDay: `${lunarMonthChinese}月${lunarDayChinese}`,

        // 生肖
        shengXiao: {
            year: safeGet(() => lunar.getYearShengXiao(), ''),
            month: safeGet(() => lunar.getMonthShengXiao(), ''),
            day: safeGet(() => lunar.getDayShengXiao(), ''),
        },

        // 干支
        ganZhi: {
            year: `${eightChar.getYearGan()}${eightChar.getYearZhi()}`,
            month: `${eightChar.getMonthGan()}${eightChar.getMonthZhi()}`,
            day: `${eightChar.getDayGan()}${eightChar.getDayZhi()}`,
            time: '', // 需要具体时间才能计算
        },

        // 纳音
        naYin: {
            year: safeGet(() => eightChar.getYearNaYin(), ''),
            month: safeGet(() => eightChar.getMonthNaYin(), ''),
            day: safeGet(() => eightChar.getDayNaYin(), ''),
        },

        // 节气
        jieQi: {
            current: currentJieQi,
            next: nextJieQi,
        },

        // 宜忌
        yi: safeGetArray(() => lunar.getDayYi()),
        ji: safeGetArray(() => lunar.getDayJi()),

        // 吉神凶煞
        jiShen: safeGetArray(() => lunar.getDayJiShen()),
        xiongSha: safeGetArray(() => lunar.getDayXiongSha()),

        // 冲煞
        chongSha: {
            chong: safeGet(() => lunar.getChongDesc(), ''),
            sha: safeGet(() => lunar.getSha(), ''),
        },

        // 空亡
        kongWang: safeGet(() => lunar.getDayXunKong(), ''),

        // 胎神 - 使用 getDayPositionTai
        taiShen: safeGet(() => lunar.getDayPositionTai(), ''),

        // 值神（天神）- 使用 getDayTianShen
        zhiShen: safeGet(() => lunar.getDayTianShen(), ''),

        // 神位 - 使用 getDayPositionXxxDesc
        shenWei: {
            caiShen: safeGet(() => lunar.getDayPositionCaiDesc(), ''),
            xiShen: safeGet(() => lunar.getDayPositionXiDesc(), ''),
            fuShen: safeGet(() => lunar.getDayPositionFuDesc(), ''),
            yangGuiShen: safeGet(() => lunar.getDayPositionYangGuiDesc(), ''),
        },

        // 二十八宿
        xiu: {
            name: safeGet(() => lunar.getXiu(), ''),
            gong: safeGet(() => `${lunar.getGong()} ${lunar.getShou()}`, ''),
            luck: safeGet(() => lunar.getXiuLuck(), ''),
            animal: safeGet(() => `${lunar.getZheng()}${lunar.getAnimal()}`, ''),
        },

        // 月相
        yueXiang: safeGet(() => lunar.getYueXiang(), ''),

        // 六曜
        liuYao: safeGet(() => lunar.getLiuYao(), ''),

        // 九星 - getDayNineStar() 返回对象，需要调用 toString()
        jiuXing: safeGet(() => lunar.getDayNineStar().toString(), ''),
        nineStar: {
            name: safeGet(() => {
                const star = lunar.getDayNineStar();
                return `${star.getNumber()}${star.getColor()}${star.getWuXing()}`;
            }, ''),
            position: safeGet(() => lunar.getDayNineStar().getPositionDesc(), ''),
        },

        // 物候
        wuHou: safeGet(() => `${lunar.getWuHou()} ${lunar.getHou()}`, ''),
        hou: {
            term: safeGet(() => lunar.getHou().replace(/\s+/gu, ''), ''),
            phenology: safeGet(() => lunar.getWuHou(), ''),
        },
    };
}

/**
 * 判断是否为黑道日
 */
export function isBlackDay(zhiShen: string): boolean {
    const blackDays = ['天刑', '朱雀', '白虎', '天牢', '玄武', '勾陈'];
    return blackDays.some(b => zhiShen.includes(b));
}

/**
 * 获取值神的吉凶描述
 */
export function getZhiShenDesc(zhiShen: string): string {
    if (isBlackDay(zhiShen)) {
        return `${zhiShen}(黑道日)`;
    }
    return `${zhiShen}(黄道日)`;
}
