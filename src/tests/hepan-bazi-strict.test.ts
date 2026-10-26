import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Solar } from 'lunar-javascript';
import { calculateBaZi, analyzeCompatibility } from '@/lib/divination/hepan';
import { calculateBazi } from 'taibu-core/bazi';

test('imported compatibility charts retain exact minutes, calendars, longitude and DST rules', () => {
    const inputs = [
        { name: 'DST', year: 2024, month: 3, day: 10, hour: 2, minute: 30, timezone: 'America/New_York', disambiguation: 'later' as const, longitude: -74 },
        { name: 'lunar', year: 2023, month: 2, day: 16, hour: 23, minute: 47, calendarType: 'lunar' as const, isLeapMonth: true, timezone: 'Asia/Shanghai', longitude: 73 },
    ];
    for (const birth of inputs) {
        const expected = calculateBazi({ gender: 'male', birthYear: birth.year, birthMonth: birth.month, birthDay: birth.day, birthHour: birth.hour, birthMinute: birth.minute, ...birth });
        const actual = calculateBaZi(birth);
        for (const pillar of ['year', 'month', 'day', 'hour'] as const) {
            assert.equal(actual[`${pillar}Gan`], expected.fourPillars[pillar]?.stem);
            assert.equal(actual[`${pillar}Zhi`], expected.fourPillars[pillar]?.branch);
        }
    }
    assert.throws(() => calculateBaZi({ ...inputs[0], disambiguation: 'reject' }));
    const result = analyzeCompatibility(inputs[0], inputs[1], 'love');
    assert.equal(result.person1.disambiguation, 'later');
    assert.equal(result.person2.minute, 47);
    assert.equal(result.person2.isLeapMonth, true);
});

test('hepan calculateBaZi should match lunar-javascript pillars', () => {
    const solar = Solar.fromYmdHms(1990, 1, 1, 10, 0, 0);
    const eightChar = solar.getLunar().getEightChar();

    const result = calculateBaZi({
        name: 'A',
        year: 1990,
        month: 1,
        day: 1,
        hour: 10,
    });

    assert.equal(result.yearGan, eightChar.getYearGan());
    assert.equal(result.yearZhi, eightChar.getYearZhi());
    assert.equal(result.monthGan, eightChar.getMonthGan());
    assert.equal(result.monthZhi, eightChar.getMonthZhi());
    assert.equal(result.dayGan, eightChar.getDayGan());
    assert.equal(result.dayZhi, eightChar.getDayZhi());
    assert.equal(result.hourGan, eightChar.getTimeGan());
    assert.equal(result.hourZhi, eightChar.getTimeZhi());
});

test('a person without a birth time has no hour pillar and no hour-based dimension', () => {
    const known = { name: '甲', year: 1990, month: 1, day: 15, hour: 9, gender: 'male' as const };
    const unknown = { name: '乙', year: 1992, month: 8, day: 3, gender: 'female' as const };
    const bazi = calculateBaZi(unknown);
    assert.equal(bazi.hourGan, undefined);
    assert.equal(bazi.hourZhi, undefined);
    // 五行只数年、月、日三柱的六个字
    assert.equal(Object.values(bazi.wuxingCount).reduce((sum, count) => sum + count, 0), 6);
    const business = analyzeCompatibility(known, unknown, 'business');
    assert.ok(!business.dimensions.some(dimension => dimension.name === '事业互补'), '没有时柱可比时不给时柱维度');
    assert.ok(analyzeCompatibility(known, { ...unknown, hour: 14 }, 'business').dimensions.some(dimension => dimension.name === '事业互补'));
    // 出生当天交节而时辰未知：月柱取决于时辰，明确报错
    assert.throws(() => calculateBaZi({ ...unknown, year: 2024, month: 3, day: 5 }), /惊蛰交节/);
});
