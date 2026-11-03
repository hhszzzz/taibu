import type { BaziFormData } from '@/types';

const today = new Date();

export const DEFAULT_BAZI_FORM_DATA: BaziFormData = {
    timezone: 'Asia/Shanghai',
    disambiguation: 'compatible',
    name: '',
    gender: 'male',
    birthYear: today.getFullYear(),
    birthMonth: today.getMonth() + 1,
    birthDay: today.getDate(),
    birthHour: -1,
    birthMinute: 0,
    calendarType: 'solar',
    isLeapMonth: false,
    birthPlace: '',
};

export const CURRENT_YEAR = new Date().getFullYear();
export const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1900 + 1 }, (_, i) => CURRENT_YEAR - i);
export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
export const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

// 农历月份中文名称
export const LUNAR_MONTH_NAMES: Record<number, string> = {
    1: '正月',
    2: '二月',
    3: '三月',
    4: '四月',
    5: '五月',
    6: '六月',
    7: '七月',
    8: '八月',
    9: '九月',
    10: '十月',
    11: '冬月',
    12: '腊月',
};

// 农历日期中文名称
export const LUNAR_DAY_NAMES: Record<number, string> = {
    1: '初一', 2: '初二', 3: '初三', 4: '初四', 5: '初五',
    6: '初六', 7: '初七', 8: '初八', 9: '初九', 10: '初十',
    11: '十一', 12: '十二', 13: '十三', 14: '十四', 15: '十五',
    16: '十六', 17: '十七', 18: '十八', 19: '十九', 20: '二十',
    21: '廿一', 22: '廿二', 23: '廿三', 24: '廿四', 25: '廿五',
    26: '廿六', 27: '廿七', 28: '廿八', 29: '廿九', 30: '三十',
};

export type HourOption = {
    value: number;
    name: string;
    time: string;
};

export const HOUR_OPTIONS: HourOption[] = [
    { value: 0, name: '子时', time: '23:00-01:00' },
    { value: 1, name: '丑时', time: '01:00-03:00' },
    { value: 3, name: '寅时', time: '03:00-05:00' },
    { value: 5, name: '卯时', time: '05:00-07:00' },
    { value: 7, name: '辰时', time: '07:00-09:00' },
    { value: 9, name: '巳时', time: '09:00-11:00' },
    { value: 11, name: '午时', time: '11:00-13:00' },
    { value: 13, name: '未时', time: '13:00-15:00' },
    { value: 15, name: '申时', time: '15:00-17:00' },
    { value: 17, name: '酉时', time: '17:00-19:00' },
    { value: 19, name: '戌时', time: '19:00-21:00' },
    { value: 21, name: '亥时', time: '21:00-23:00' },
];
