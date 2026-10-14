import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBaziChartBundle } from '../lib/divination/bazi';
import { getCalendarAlmanac } from '../lib/divination/calendar';
import { calculateDailyFortune, calculateGenericDailyFortune, chartScoreToFortuneLevel } from '../lib/divination/fortune';
import { DAILY_TEN_GOD_HEADLINES, getDailyHeadline } from '../lib/divination/fortune-interpretations';

const TEN_GODS = ['比肩', '劫财', '食神', '伤官', '偏财', '正财', '七杀', '正官', '偏印', '正印'];
const LEVEL_KEYS = ['overall', 'career', 'love', 'wealth', 'health', 'social'] as const;

function buildSampleChart() {
    return calculateBaziChartBundle({
        name: '林知夏',
        gender: 'female',
        birthYear: 1984,
        birthMonth: 9,
        birthDay: 27,
        birthHour: 4,
        birthMinute: 20,
        calendarType: 'solar',
    }).output;
}

test('getDailyHeadline covers all ten gods with distinct headlines', () => {
    assert.deepEqual(Object.keys(DAILY_TEN_GOD_HEADLINES).sort(), [...TEN_GODS].sort());
    const headlines = TEN_GODS.map((tenGod) => getDailyHeadline(tenGod));
    for (const [index, headline] of headlines.entries()) {
        assert.ok(headline && headline.length > 0, TEN_GODS[index]);
    }
    assert.equal(new Set(headlines).size, TEN_GODS.length);
    assert.equal(getDailyHeadline('伤官'), '食伤当令，宜表达，不宜硬碰');
});

test('getDailyHeadline returns null for missing or unknown ten gods', () => {
    assert.equal(getDailyHeadline(undefined), null);
    assert.equal(getDailyHeadline(null), null);
    assert.equal(getDailyHeadline(''), null);
    assert.equal(getDailyHeadline('日主'), null);
});

test('every ten god produced by the daily fortune engine has a headline', () => {
    const output = buildSampleChart();
    const seen = new Set<string>();
    for (let offset = 0; offset < 20; offset += 1) {
        const fortune = calculateDailyFortune(output, new Date(2026, 9, 1 + offset));
        seen.add(fortune.tenGod);
        assert.ok(getDailyHeadline(fortune.tenGod), `${fortune.date} ${fortune.tenGod}`);
    }
    // 连续 20 天覆盖十个天干，十神应全部出现
    assert.equal(seen.size, TEN_GODS.length);
});

test('getCalendarAlmanac exposes mansion animal, day nine star and phenology parts', () => {
    const almanac = getCalendarAlmanac(new Date(2026, 9, 10));
    assert.deepEqual(almanac.xiu, { name: '柳', gong: '南 朱雀', luck: '凶', animal: '土獐' });
    assert.deepEqual(almanac.nineStar, { name: '四绿木', position: '东南' });
    assert.deepEqual(almanac.hou, { term: '寒露初候', phenology: '鸿雁来宾' });
    assert.equal(almanac.chongSha.chong, '(辛亥)猪');
    assert.equal(almanac.chongSha.sha, '东');
});

test('chartScoreToFortuneLevel follows the level thresholds', () => {
    const cases: Array<[number, string]> = [
        [98, '大吉'], [85, '大吉'], [84, '吉'], [75, '吉'], [74, '中吉'], [65, '中吉'],
        [64, '平'], [55, '平'], [54, '小凶'], [45, '小凶'], [44, '凶'], [30, '凶'],
    ];
    for (const [score, level] of cases) {
        assert.equal(chartScoreToFortuneLevel(score), level, String(score));
    }
});

test('trend chart scores map back to the levels shown on the cards', () => {
    const output = buildSampleChart();
    for (let offset = 0; offset < 31; offset += 1) {
        const date = new Date(2026, 9, 1 + offset);
        const personal = calculateDailyFortune(output, date);
        const generic = calculateGenericDailyFortune(date);
        for (const key of LEVEL_KEYS) {
            assert.equal(chartScoreToFortuneLevel(personal._chart[key]), personal[key], `${personal.date} ${key}`);
            assert.equal(chartScoreToFortuneLevel(generic._chart[key]), generic[key], `generic ${personal.date} ${key}`);
        }
    }
});
