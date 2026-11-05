import { LunarYear } from 'lunar-javascript';
import type { BaziFormData, CalendarType, Gender } from '@/types';
import { DEFAULT_BAZI_FORM_DATA } from '@/components/bazi/form/options';
import { parseNumberParam } from '@/lib/divination/bazi-form-utils';
import { parseLongitude } from '@/lib/divination/place-resolution';
import { readBirthTimeOptions } from '@/lib/divination/birth-time';

type SearchParamsReader = {
    get: (key: string) => string | null;
};

export const ZIWEI_LEGACY_UNKNOWN_TIME_SENTINEL = '-1';
export const ZIWEI_BIRTH_TIME_REQUIRED_MESSAGE = '紫微斗数必须提供出生时辰，请先补全后再排盘';

function hasPrefilledBirthInfo(searchParams: SearchParamsReader) {
    return ['name', 'gender', 'year', 'month', 'day', 'calendar', 'place', 'longitude', 'leap']
        .some((key) => searchParams.get(key) !== null);
}

function hasValidClockInput(hour: string | null, minute: string | null) {
    if (!hour || hour === ZIWEI_LEGACY_UNKNOWN_TIME_SENTINEL) {
        return false;
    }
    const birthHour = Number(hour);
    const birthMinute = Number(minute ?? '0');
    return Number.isInteger(birthHour)
        && birthHour >= 0
        && birthHour <= 23
        && Number.isInteger(birthMinute)
        && birthMinute >= 0
        && birthMinute <= 59;
}

export function buildInitialZiweiFormState(searchParams: SearchParamsReader): {
    formData: BaziFormData;
    requiresBirthTimeConfirmation: boolean;
} {
    const name = searchParams.get('name');
    const gender = searchParams.get('gender') as Gender | null;
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const day = searchParams.get('day');
    const hour = searchParams.get('hour');
    const minute = searchParams.get('minute');
    const calendar = searchParams.get('calendar') as CalendarType | null;
    const place = searchParams.get('place');
    const leap = searchParams.get('leap');
    const longitude = searchParams.get('longitude');

    if (!name && !year) {
        return {
            formData: { ...DEFAULT_BAZI_FORM_DATA, ...readBirthTimeOptions(searchParams) },
            requiresBirthTimeConfirmation: false,
        };
    }

    const birthYear = parseNumberParam(year, DEFAULT_BAZI_FORM_DATA.birthYear);
    const birthMonth = parseNumberParam(month, DEFAULT_BAZI_FORM_DATA.birthMonth);
    const isLeapRequested = calendar === 'lunar' && leap === '1';
    const leapMonthOfYear = calendar === 'lunar'
        ? LunarYear.fromYear(birthYear).getLeapMonth()
        : 0;
    const requiresBirthTimeConfirmation = hasPrefilledBirthInfo(searchParams) && !hasValidClockInput(hour, minute);

    return {
        requiresBirthTimeConfirmation,
        formData: {
            name: name || '',
            gender: gender === 'female' ? 'female' : 'male',
            birthYear,
            birthMonth,
            birthDay: parseNumberParam(day, DEFAULT_BAZI_FORM_DATA.birthDay),
            birthHour: requiresBirthTimeConfirmation
                ? DEFAULT_BAZI_FORM_DATA.birthHour
                : parseNumberParam(hour, DEFAULT_BAZI_FORM_DATA.birthHour),
            birthMinute: requiresBirthTimeConfirmation
                ? DEFAULT_BAZI_FORM_DATA.birthMinute
                : parseNumberParam(minute, DEFAULT_BAZI_FORM_DATA.birthMinute),
            calendarType: calendar === 'lunar' ? 'lunar' : 'solar',
            isLeapMonth: isLeapRequested && leapMonthOfYear === birthMonth,
            birthPlace: place || '',
            longitude: parseLongitude(longitude),
            ...readBirthTimeOptions(searchParams),
        },
    };
}
