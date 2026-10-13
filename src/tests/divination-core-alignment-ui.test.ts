import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBaziChartBundle, generateBaziChartText } from '@/lib/divination/bazi';
import { calculateZiweiChartBundle, generateZiweiChartText } from '@/lib/divination/ziwei';
import {
    buildLiuyaoCanonicalJSON,
    calculateLiuyaoBundle,
    findHexagram,
    formatHexagramPalace,
    type Yao,
    calculateDerivedHexagrams,
    calculateGuaShen,
    generateLiuyaoChartText,
} from '@/lib/divination/liuyao';
import { TAROT_CARDS, drawForSpread, generateTarotReadingText } from '@/lib/divination/tarot';

test('bazi shared chart text should use the slimmer default layout while preserving key runtime facts', () => {
    const bundle = calculateBaziChartBundle({
        name: '测试',
        gender: 'male',
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        birthHour: 12,
        birthMinute: 0,
        birthPlace: '上海',
        longitude: 121.47,
        calendarType: 'solar',
    });
    const chart = bundle.output;

    const text = generateBaziChartText(chart, { name: bundle.meta.name, meta: bundle.meta });

    assert.match(text, /命局全盘/u, 'bazi text should expose the default chart overview section');
    assert.match(text, /真太阳时/u, 'bazi text should expose true solar time info when core provides it');
    assert.match(text, /干支关系/u, 'bazi text should expose consolidated relations section');
    assert.match(text, /大运轨迹/u, 'bazi text should expose the slim dayun summary by default');
    assert.match(text, /半合/u, 'bazi text should expose diZhiBanHe when data exists');
    assert.doesNotMatch(text, /命主五行/u, 'bazi text should drop the old day-master element summary from default output');
    assert.doesNotMatch(text, /胎元/u, 'bazi text should drop taiYuan from the slimmer default output');
    assert.doesNotMatch(text, /命宫/u, 'bazi text should drop mingGong from the slimmer default output');
});

test('bazi chart text should keep hidden stem details, diShi, and kong markers in the new table layout', () => {
    const { output: chart } = calculateBaziChartBundle({
        name: '测试',
        gender: 'male',
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        birthHour: 12,
        birthMinute: 0,
        birthPlace: '上海',
        longitude: 121.47,
        calendarType: 'solar',
    });

    const text = generateBaziChartText(chart);
    const qiType = chart.fourPillars.year.hiddenStems[0]?.qiType;

    assert.ok(qiType, 'bazi hidden stem details should include qiType from core output');
    assert.match(text, /地势/u, 'bazi text should include diShi markers for pillars');
    assert.match(text, /空亡/u, 'bazi text should include kong markers for pillars');
    assert.match(text, /地支藏干\(十神\)/u, 'bazi text should expose the hidden-stem column header');
    const firstHiddenStem = chart.fourPillars.year.hiddenStems[0];
    assert.ok(firstHiddenStem, 'bazi hidden stem details should exist');
    assert.match(text, new RegExp(firstHiddenStem.stem), 'bazi text should surface hidden stem name');
    assert.doesNotMatch(text, /纳音/u, 'bazi text should drop naYin from the slimmer default output');
});

test('web divination adapters should use explicit longitude instead of local fuzzy place matching', () => {
    const { output: baziChart } = calculateBaziChartBundle({
        name: '测试',
        gender: 'male',
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        birthHour: 12,
        birthMinute: 0,
        calendarType: 'solar',
        longitude: 121.47,
    });

    const ziweiChart = calculateZiweiChartBundle({
        name: '测试',
        gender: 'male',
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        birthHour: 12,
        birthMinute: 0,
        calendarType: 'solar',
        longitude: 121.47,
    } as Parameters<typeof calculateZiweiChartBundle>[0] & { longitude: number }).output;

    assert.equal(baziChart.trueSolarTimeInfo?.longitude, 121.47);
    assert.equal(ziweiChart.trueSolarTimeInfo?.longitude, 121.47);
});

test('ziwei web contract should keep core metadata while default copy text stays compact and ordered', () => {
    const chart = calculateZiweiChartBundle({
        name: '测试',
        gender: 'male',
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        birthHour: 12,
        birthMinute: 0,
        calendarType: 'solar',
    }).output;

    assert.ok(typeof (chart as unknown as Record<string, unknown>).douJun === 'string', 'ziwei chart should preserve douJun from core output');
    assert.ok(typeof (chart as unknown as Record<string, unknown>).lifeMasterStar === 'string', 'ziwei chart should preserve lifeMasterStar from core output');
    assert.ok(typeof (chart as unknown as Record<string, unknown>).bodyMasterStar === 'string', 'ziwei chart should preserve bodyMasterStar from core output');
    assert.ok(Array.isArray((chart as unknown as Record<string, unknown>).smallLimit), 'ziwei chart should preserve smallLimit from core output');
    assert.ok(Array.isArray((chart as unknown as Record<string, unknown>).scholarStars), 'ziwei chart should preserve scholarStars from core output');

    const text = generateZiweiChartText(chart);
    assert.match(text, /生年四化/u, 'ziwei default text should include birth-year mutagen summary');
    assert.doesNotMatch(text, /子年斗君/u, 'ziwei default text should omit douJun');
    assert.doesNotMatch(text, /命主星/u, 'ziwei default text should omit life master star');
    assert.doesNotMatch(text, /身主星/u, 'ziwei default text should omit body master star');
    assert.doesNotMatch(text, /小限/u, 'ziwei default text should omit small-limit arrays');
    assert.doesNotMatch(text, /博士/u, 'ziwei default text should omit shensha column');

    const headingLines = text
        .split('\n')
        .filter((line) => /^\| [^|]+ \|/u.test(line) && !line.includes('宫位') && !line.includes('------') && !line.includes('年柱') && !line.includes('月柱') && !line.includes('日柱') && !line.includes('时柱') && !line.includes('柱 |'))
        .slice(0, 6);
    assert.deepEqual(
        headingLines.map((line) => line.split('|')[1]?.trim().replace(/\(身宫\)$/u, '').replace(/\(来因\)$/u, '') || ''),
        ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄'],
        'ziwei text should render palace sections in the traditional reading order instead of raw storage order',
    );
});

test('ziwei star mutagen variants should be surfaced in text output', () => {
    const chart = calculateZiweiChartBundle({
        name: '测试',
        gender: 'male',
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        birthHour: 12,
        birthMinute: 0,
        calendarType: 'solar',
    }).output;

    const palace = chart.palaces[0];
    if (palace?.majorStars?.[0]) {
        palace.majorStars[0].selfMutagen = '禄';
        palace.majorStars[0].oppositeMutagen = '权';
    }

    const text = generateZiweiChartText(chart);
    assert.match(text, /↓禄/u, 'ziwei text should include self mutagen markers');
    assert.match(text, /↑权/u, 'ziwei text should include opposite mutagen markers');
});

test('liuyao prompt should include derived hexagrams and gua shen', () => {
    const hexagram = findHexagram('111111');
    assert.ok(hexagram, 'hexagram should exist for testing');

    const yaos: Yao[] = Array.from({ length: 6 }, (_, index) => ({
        type: 1,
        change: 'stable',
        position: index + 1,
    }));

    const bundle = calculateLiuyaoBundle({
        yaos,
        question: '测试问题',
        date: new Date('2026-01-01T00:00:00Z'),
        yongShenTargets: ['父母'],
        hexagram: hexagram!,
    });
    const text = generateLiuyaoChartText(bundle.output);

    assert.match(text, /互卦/u, 'liuyao prompt should include nuclear hexagram');
    assert.match(text, /错卦/u, 'liuyao prompt should include opposite hexagram');
    assert.match(text, /综卦/u, 'liuyao prompt should include reversed hexagram');
    assert.match(text, /卦身/u, 'liuyao prompt should include gua shen');
    assert.doesNotMatch(text, /互卦：无/u, 'liuyao prompt should resolve nuclear hexagram instead of placeholder');
    assert.doesNotMatch(text, /错卦：无/u, 'liuyao prompt should resolve opposite hexagram instead of placeholder');
    assert.doesNotMatch(text, /综卦：无/u, 'liuyao prompt should resolve reversed hexagram instead of placeholder');
    assert.doesNotMatch(text, /卦身：无/u, 'liuyao prompt should resolve gua shen instead of placeholder');
});

test('liuyao bundle should attach 爻辞 so canonical JSON and text carry changing-line texts like core', () => {
    const hexagram = findHexagram('101111');
    const changedHexagram = findHexagram('111111');
    assert.ok(hexagram && changedHexagram, 'hexagrams should exist for testing');

    const yaos: Yao[] = '101111'.split('').map((value, index) => ({
        type: value === '1' ? 1 : 0,
        change: index === 1 ? 'changing' : 'stable',
        position: index + 1,
    }));
    const bundle = calculateLiuyaoBundle({
        yaos,
        question: '测试问题',
        date: new Date('2026-01-01T00:00:00Z'),
        yongShenTargets: ['官鬼'],
        hexagram: hexagram!,
        changedHexagram: changedHexagram!,
    });

    assert.equal(bundle.output.fullYaos[0]?.yaoCi, '初九：同人于门，无咎。', 'every line should carry its base-hexagram text');
    assert.deepEqual(
        buildLiuyaoCanonicalJSON(bundle.output).卦盘.变卦?.动爻爻辞,
        [{ 爻名: '六二', 爻辞: '六二：同人于宗，吝。' }],
        'canonical JSON should list only the changing line texts',
    );
    assert.match(generateLiuyaoChartText(bundle.output), /六二爻辞: 六二：同人于宗，吝。/u, 'shared text should include the changing line text');
});

test('liuyao bundle reports the 卦宫 element like core instead of the upper trigram element', () => {
    // 天火同人属离宫火而上卦为乾金；变卦乾为天属乾宫金
    const yaos: Yao[] = '101111'.split('').map((value, index) => ({
        type: value === '1' ? 1 : 0,
        change: index === 1 ? 'changing' : 'stable',
        position: index + 1,
    }));
    const bundle = calculateLiuyaoBundle({
        yaos,
        question: '测试问题',
        date: new Date('2026-01-01T00:00:00Z'),
        yongShenTargets: ['官鬼'],
        hexagram: findHexagram('101111')!,
        changedHexagram: findHexagram('111111')!,
    });

    const board = buildLiuyaoCanonicalJSON(bundle.output).卦盘;
    assert.deepEqual([board.本卦.卦宫, board.本卦.五行, board.变卦?.卦宫, board.变卦?.五行], ['离', '火', '乾', '金']);
    assert.match(generateLiuyaoChartText(bundle.output), /天火同人（离宫·火）/u);
});

test('liuyao hexagram pickers label the 卦宫 element, not the upper trigram element', () => {
    assert.equal(formatHexagramPalace('010111'), '离宫火', '天水讼属离宫，上卦乾金不是卦的五行');
    assert.equal(formatHexagramPalace('010000'), '坎宫水');
    assert.equal(formatHexagramPalace('111111'), '乾宫金');
    assert.equal(formatHexagramPalace(''), '');
});

test('liuyao derived helpers should handle invalid hexagram codes defensively', () => {
    const derived = calculateDerivedHexagrams('');
    assert.equal(Object.keys(derived).length, 0, 'invalid hexagram code should not yield derived results');

    const guaShen = calculateGuaShen('');
    assert.equal(guaShen.absent, true, 'invalid hexagram code should return an absent gua shen');
});

test('tarot shared reading text should include core-aligned card metadata and numerology when provided', () => {
    const text = generateTarotReadingText({
        spreadName: '单牌',
        question: '今天如何？',
        cards: [
            {
                position: '当前指引',
                orientation: 'upright',
                meaning: '适合主动推进',
                card: {
                    name: 'The Sun',
                    nameChinese: '太阳',
                    keywords: ['成功', '清晰'],
                    element: '火',
                    number: 19,
                    astrologicalCorrespondence: '太阳',
                    reversedKeywords: ['消极', '迟滞'],
                },
            },
        ],
        numerology: {
            personalityCard: { number: 1, name: 'The Magician', nameChinese: '魔术师' },
            soulCard: { number: 2, name: 'The High Priestess', nameChinese: '女祭司' },
            yearlyCard: { number: 19, name: 'The Sun', nameChinese: '太阳', year: 2026 },
        },
    } as unknown as Parameters<typeof generateTarotReadingText>[0]);

    assert.match(text, /太阳/u, 'tarot text should include chinese card name');
    assert.match(text, /元素/u, 'tarot text should include card element');
    assert.match(text, /星象/u, 'tarot text should include astrological correspondence when provided');
    assert.match(text, /求问者生命数字/u, 'tarot text should include numerology section when provided');
    assert.match(text, /人格牌/u, 'tarot numerology section should include personality card');
});

test('tarot shared reading text should include birthDate when provided', () => {
    const text = generateTarotReadingText({
        spreadName: '单牌',
        cards: [],
        birthDate: '1990-01-01',
    } as unknown as Parameters<typeof generateTarotReadingText>[0]);

    assert.match(text, /出生日期/u, 'tarot text should include birth date label');
    assert.match(text, /1990-01-01/u, 'tarot text should include birth date value');
});

test('tarot draw should accept ISO datetime birthDate for numerology', async () => {
    const result = await drawForSpread('single', true, {
        birthDate: '1990-01-01T00:00:00Z',
        seed: 'tdd-numerology',
    });

    assert.ok(result?.numerology, 'tarot draw should return numerology when birth date is provided');
});

test('tarot display catalog should reuse core chinese card names instead of legacy web aliases', () => {
    assert.equal(TAROT_CARDS.find((card) => card.name === 'The Fool')?.nameChinese, '愚者');
    assert.equal(TAROT_CARDS.find((card) => card.name === 'The Empress')?.nameChinese, '女皇');
    assert.equal(TAROT_CARDS.find((card) => card.name === 'The Tower')?.nameChinese, '塔');
});
