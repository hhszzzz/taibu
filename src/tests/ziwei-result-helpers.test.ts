import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildZiweiCanonicalJSON,
    calculateZiweiChartBundle,
    calculateZiweiPalaceFlights,
    getDecadalList,
    getZiweiCurrentPeriods,
    getZiweiLunarBirthYear,
    resolveZiweiFlightOverlay,
    shiftZiweiBirthHour,
    type ZiweiFormData,
} from '../lib/divination/ziwei';

const FORM: ZiweiFormData = {
    name: '林知夏',
    gender: 'female',
    birthYear: 1984,
    birthMonth: 9,
    birthDay: 27,
    birthHour: 4,
    birthMinute: 20,
    calendarType: 'solar',
};

const bundle = calculateZiweiChartBundle(FORM);
const palaceNameAt = (index: number) =>
    buildZiweiCanonicalJSON(bundle.output).十二宫位.find((palace) => palace.宫位索引 === index)?.宫位;

test('getZiweiCurrentPeriods places the current decade, year and small limit on natal palaces', () => {
    const periods = getZiweiCurrentPeriods(bundle.output, bundle.astrolabe, new Date(2026, 9, 12));
    assert.deepEqual(periods, {
        decadal: { index: 3, ganZhi: '己巳', startAge: 34, endAge: 43 },
        yearly: { index: 4, ganZhi: '丙午' },
        age: { index: 2, ganZhi: '戊辰' },
    });
    assert.equal(palaceNameAt(3), '子女');
    assert.equal(palaceNameAt(4), '夫妻');
    assert.equal(palaceNameAt(2), '财帛');
});

test('getZiweiCurrentPeriods drops layers core cannot place instead of leaking -1 indices', () => {
    const beyondLastDecade = getZiweiCurrentPeriods(bundle.output, bundle.astrolabe, new Date(2120, 0, 1));
    assert.equal(beyondLastDecade.decadal, null);
    assert.equal(beyondLastDecade.age, null);
    assert.ok(beyondLastDecade.yearly && beyondLastDecade.yearly.index >= 0 && beyondLastDecade.yearly.index < 12);
});

test('getZiweiCurrentPeriods reports nothing before the birth date', () => {
    assert.deepEqual(
        getZiweiCurrentPeriods(bundle.output, bundle.astrolabe, new Date(1984, 8, 26)),
        { decadal: null, yearly: null, age: null },
    );
    const unborn = calculateZiweiChartBundle({ ...FORM, birthYear: 2030 });
    assert.deepEqual(
        getZiweiCurrentPeriods(unborn.output, unborn.astrolabe, new Date(2026, 9, 12)),
        { decadal: null, yearly: null, age: null },
    );
});

test('getZiweiLunarBirthYear maps nominal ages to the years core counts in each decade', () => {
    const lunarBirthYear = getZiweiLunarBirthYear(bundle.output);
    assert.equal(lunarBirthYear, 1984);
    const yearOfAge = (age: number) => lunarBirthYear! + age - 1;
    const decadeAt = (year: number) => getZiweiCurrentPeriods(bundle.output, bundle.astrolabe, new Date(year, 5, 15)).decadal;

    // 子女大限 34–43 岁：2017（虚岁 34）至 2026（虚岁 43）
    assert.equal(decadeAt(yearOfAge(34))?.startAge, 34);
    assert.equal(decadeAt(yearOfAge(43))?.startAge, 34);
    assert.equal(decadeAt(yearOfAge(34) - 1)?.startAge, 24);
    assert.equal(decadeAt(yearOfAge(43) + 1)?.startAge, 44);
});

test('getZiweiLunarBirthYear uses the lunar year for births before the lunar new year', () => {
    // 1985-01-20 仍属农历甲子年（1984），1985-02-20 为乙丑年正月初一
    const beforeNewYear = calculateZiweiChartBundle({ ...FORM, birthYear: 1985, birthMonth: 1, birthDay: 20 });
    assert.equal(getZiweiLunarBirthYear(beforeNewYear.output), 1984);
    const newYearDay = calculateZiweiChartBundle({ ...FORM, birthYear: 1985, birthMonth: 2, birthDay: 20 });
    assert.equal(getZiweiLunarBirthYear(newYearDay.output), 1985);

    // 首个大限的最后一年按农历出生年推算仍在该大限内；若误用阳历年（1985）会多算一岁、跨入下一大限
    const [firstDecade] = getDecadalList(beforeNewYear.output).sort((left, right) => left.startAge - right.startAge);
    const decadeAt = (year: number) => getZiweiCurrentPeriods(beforeNewYear.output, beforeNewYear.astrolabe, new Date(year, 5, 15)).decadal;
    assert.equal(decadeAt(1984 + firstDecade.endAge - 1)?.startAge, firstDecade.startAge);
    assert.equal(decadeAt(1985 + firstDecade.endAge - 1)?.startAge, firstDecade.startAge + 10);
});

test('calculateZiweiPalaceFlights returns every palace stem in traditional order with natal targets', async () => {
    const palaces = await calculateZiweiPalaceFlights(FORM);
    assert.deepEqual(
        palaces.map((item) => item.palace),
        ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '交友', '官禄', '田宅', '福德', '父母'],
    );
    assert.deepEqual(palaces[0], {
        palace: '命宫',
        ganZhi: '壬申',
        flights: [
            { mutagen: '禄', starName: '天梁', targetPalace: '命宫' },
            { mutagen: '权', starName: '紫微', targetPalace: '交友' },
            { mutagen: '科', starName: '左辅', targetPalace: '官禄' },
            { mutagen: '忌', starName: '武曲', targetPalace: '父母' },
        ],
    });

    const natalNames = new Set(buildZiweiCanonicalJSON(bundle.output).十二宫位.map((palace) => palace.宫位));
    for (const { palace, flights } of palaces) {
        assert.deepEqual(flights.map((flight) => flight.mutagen), ['禄', '权', '科', '忌'], palace);
        for (const flight of flights) {
            assert.ok(flight.targetPalace && natalNames.has(flight.targetPalace), `${palace} 化${flight.mutagen} → ${flight.targetPalace}`);
        }
    }
});

test('calculateZiweiPalaceFlights follows the adjusted birth hour', async () => {
    const [lifePalace] = await calculateZiweiPalaceFlights({ ...FORM, birthHour: 6 });
    assert.equal(lifePalace.palace, '命宫');
    assert.notEqual(lifePalace.ganZhi, '壬申');
});

test('shiftZiweiBirthHour keeps the input untouched without an offset', () => {
    assert.equal(shiftZiweiBirthHour(FORM, 0), FORM);
    assert.deepEqual(shiftZiweiBirthHour(FORM, 2), { ...FORM, birthHour: 6 });
    assert.equal(FORM.birthHour, 4);
});

test('shiftZiweiBirthHour rolls solar dates across days, years and leap days', () => {
    const at = (birthYear: number, birthMonth: number, birthDay: number, birthHour: number): ZiweiFormData => ({ ...FORM, birthYear, birthMonth, birthDay, birthHour });
    assert.deepEqual(shiftZiweiBirthHour(at(1984, 9, 27, 23), 1), at(1984, 9, 28, 0));
    assert.deepEqual(shiftZiweiBirthHour(at(2000, 1, 1, 0), -1), at(1999, 12, 31, 23));
    assert.deepEqual(shiftZiweiBirthHour(at(2024, 2, 28, 23), 2), at(2024, 2, 29, 1));
    assert.deepEqual(shiftZiweiBirthHour(at(2023, 2, 28, 23), 2), at(2023, 3, 1, 1));
    assert.deepEqual(shiftZiweiBirthHour(at(2000, 1, 1, 0), -25), at(1999, 12, 30, 23));
});

test('shiftZiweiBirthHour walks lunar months in and out of a leap month', () => {
    const lunar = (birthMonth: number, birthDay: number, birthHour: number, isLeapMonth = false): ZiweiFormData => ({
        ...FORM, calendarType: 'lunar', birthYear: 2023, birthMonth, birthDay, birthHour, isLeapMonth,
    });
    // 2023 年闰二月：二月 30 天，闰二月 29 天
    assert.deepEqual(shiftZiweiBirthHour(lunar(2, 30, 23), 1), lunar(2, 1, 0, true));
    assert.deepEqual(shiftZiweiBirthHour(lunar(2, 29, 23, true), 1), lunar(3, 1, 0));
    assert.deepEqual(shiftZiweiBirthHour(lunar(3, 1, 0), -1), lunar(2, 29, 23, true));
    assert.deepEqual(
        shiftZiweiBirthHour({ ...lunar(12, 30, 23), birthYear: 2023 }, 1),
        { ...lunar(1, 1, 0), birthYear: 2024 },
    );
});

test('shiftZiweiBirthHour rejects a leap month the lunar year does not have', () => {
    assert.throws(() => shiftZiweiBirthHour({ ...FORM, calendarType: 'lunar', birthYear: 2024, birthMonth: 4, birthDay: 1, birthHour: 0, isLeapMonth: true }, -1));
});

test('resolveZiweiFlightOverlay maps palace names onto chart indices and skips unknown targets', () => {
    const palaces = buildZiweiCanonicalJSON(bundle.output).十二宫位;
    const overlay = resolveZiweiFlightOverlay(palaces, {
        palace: '命宫',
        ganZhi: '壬申',
        flights: [
            { mutagen: '禄', starName: '天梁', targetPalace: '命宫' },
            { mutagen: '权', starName: '紫微', targetPalace: '交友' },
            { mutagen: '科', starName: null, targetPalace: null },
            { mutagen: '忌', starName: '武曲', targetPalace: '不存在' },
        ],
    });
    assert.deepEqual(overlay, {
        sourceIndex: 6,
        flights: [
            { mutagen: '禄', starName: '天梁', targetIndex: 6 },
            { mutagen: '权', starName: '紫微', targetIndex: 11 },
        ],
    });
    assert.equal(resolveZiweiFlightOverlay(palaces, { palace: '不存在', ganZhi: '', flights: [] }), null);
});
