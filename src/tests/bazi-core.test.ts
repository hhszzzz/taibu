import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DI_ZHI, getDiShi, STEM_ELEMENTS, TIAN_GAN, ZHI_WUXING as BRANCH_ELEMENTS } from 'taibu-core/utils';
import { calculateBazi, calculateBaziFiveElementsStats, calculateBaziShenShaData, toBaziText } from 'taibu-core/bazi';
import { calculateBaziDayun } from 'taibu-core/bazi-dayun';
import { readBirthTimeOptions, resolveBirthTimeOptions, writeBirthTimeOptions } from '@/lib/divination/birth-time';
import { buildInitialZiweiFormState } from '@/lib/divination/ziwei-form';
import { reversePillars } from '@/lib/divination/pillars-reverse';
import {
    HIDDEN_STEMS,
    calculateTenGod,
    calculateBaziChartBundle,
    calculateShenSha,
    calculateProfessionalData,
    calculateLiuYue,
    calculateLiuRi,
    generateBaziChartText,
    LIU_HE_TABLE,
    LIU_CHONG_TABLE,
    SAN_HE_TABLE,
} from '@/lib/divination/bazi';
import { formatLunarDateFromSolar, parseNumberParam } from '@/lib/divination/bazi-form-utils';
import type { HeavenlyStem, BaziFormData, TenGod } from '@/types';

describe('birth time rule adapters', () => {
    const form: BaziFormData = {
        name: 'DST', gender: 'male', calendarType: 'solar',
        birthYear: 2024, birthMonth: 3, birthDay: 10, birthHour: 2, birthMinute: 30,
        timezone: 'America/New_York', disambiguation: 'later', longitude: -74,
    };

    it('validates options and preserves them through URL/form codecs', () => {
        assert.deepEqual(resolveBirthTimeOptions({}), { timezone: 'Asia/Shanghai', disambiguation: 'reject' });
        assert.throws(() => resolveBirthTimeOptions({ timezone: 'invalid/timezone' }));
        assert.throws(() => resolveBirthTimeOptions({ disambiguation: 'invalid' }));
        assert.deepEqual(readBirthTimeOptions(new URLSearchParams()), {});
        const params = new URLSearchParams('year=2024&month=3&day=10&hour=2&minute=30');
        writeBirthTimeOptions(params, form);
        assert.deepEqual(readBirthTimeOptions(params), { timezone: form.timezone, disambiguation: 'later' });
        const restored = buildInitialZiweiFormState(params).formData;
        assert.equal(restored.timezone, form.timezone);
        assert.equal(restored.disambiguation, 'later');
    });

    it('uses the same time rules in chart, shensha, fortune and canonical dayun calculations', () => {
        const core = calculateBazi({ ...form, calendarType: 'solar' });
        const dayun = calculateBaziDayun({ ...form, calendarType: 'solar' });
        const { output, meta } = calculateBaziChartBundle(form);
        assert.deepEqual(output, core);
        assert.equal(meta.timezone, form.timezone);
        assert.equal(meta.disambiguation, 'later');
        assert.equal(meta.longitude, -74);
        assert.deepEqual(calculateShenSha(form).pillarShenSha, calculateBaziShenShaData({ ...form, calendarType: 'solar' }).pillarShenSha);
        assert.equal(calculateProfessionalData(form).startAgeDetail, dayun.startAgeDetail);
        assert.equal(calculateLiuYue(2024, form).length, 12);
        assert.equal(calculateLiuRi('2024-03-10', '2024-03-11', form).length, 2);
        assert.equal(generateBaziChartText(output, { meta, detailLevel: 'full' }), toBaziText(core, { dayun, detailLevel: 'full' }));
        for (const calculate of [calculateBaziChartBundle, calculateProfessionalData, calculateShenSha]) {
            assert.throws(() => calculate({ ...form, disambiguation: 'reject' }));
        }
    });

    it('reuses complete Core inverse search, preserving original minutes and checking hour stems', async () => {
        const output = calculateBazi({ ...form, calendarType: 'solar' });
        const results = await reversePillars(output.fourPillars, form);
        assert.ok(results.some(result => result.year === 2024 && result.month === 3 && result.day === 10));
        for (const result of results) {
            const recalculated = calculateBazi({ ...form, calendarType: 'solar', birthYear: result.year, birthMonth: result.month, birthDay: result.day, birthHour: result.hour, birthMinute: result.minute });
            for (const pillar of ['year', 'month', 'day', 'hour'] as const) {
                assert.equal(recalculated.fourPillars[pillar].stem, output.fourPillars[pillar].stem);
                assert.equal(recalculated.fourPillars[pillar].branch, output.fourPillars[pillar].branch);
            }
        }
    });
});

describe('parseNumberParam', () => {
    it('preserves early-child-hour zero values from URL and form inputs', () => {
        assert.equal(parseNumberParam('0', 12), 0);
        assert.equal(parseNumberParam('00', 12), 0);
        assert.equal(parseNumberParam('12', 0), 12);
    });

    it('uses the fallback only for missing or invalid values', () => {
        assert.equal(parseNumberParam(null, 12), 12);
        assert.equal(parseNumberParam('', 12), 12);
        assert.equal(parseNumberParam('not-a-number', 12), 12);
    });
});

describe('formatLunarDateFromSolar', () => {
    it('formats the lunar year ganzhi, month and day for a solar birth date', () => {
        assert.equal(formatLunarDateFromSolar(1984, 9, 27), '甲子年九月初三');
        assert.equal(formatLunarDateFromSolar(2024, 2, 10), '甲辰年正月初一');
    });

    it('marks leap months', () => {
        assert.equal(formatLunarDateFromSolar(2020, 6, 1), '庚子年闰四月初十');
    });

    it('returns null for impossible or malformed dates instead of guessing', () => {
        assert.equal(formatLunarDateFromSolar(2023, 2, 30), null);
        assert.equal(formatLunarDateFromSolar(2023, 13, 1), null);
        assert.equal(formatLunarDateFromSolar(0, 1, 1), null);
        assert.equal(formatLunarDateFromSolar(2023.5, 1, 1), null);
        assert.equal(formatLunarDateFromSolar(Number.NaN, 1, 1), null);
    });
});

// ===== 1. 十神计算 (calculateTenGod) =====

describe('calculateTenGod', () => {
    it('甲日主见十天干的十神', () => {
        const cases: [HeavenlyStem, TenGod][] = [
            ['甲', '比肩'],
            ['乙', '劫财'],
            ['丙', '食神'],
            ['丁', '伤官'],
            ['戊', '偏财'],
            ['己', '正财'],
            ['庚', '七杀'],
            ['辛', '正官'],
            ['壬', '偏印'],
            ['癸', '正印'],
        ];
        for (const [target, expected] of cases) {
            assert.equal(
                calculateTenGod('甲', target),
                expected,
                `甲日主见${target}应为${expected}`
            );
        }
    });

    it('阴干日主的十神计算', () => {
        // 乙(阴木)日主
        assert.equal(calculateTenGod('乙', '甲'), '劫财');
        assert.equal(calculateTenGod('乙', '乙'), '比肩');
        assert.equal(calculateTenGod('乙', '丙'), '伤官');
        assert.equal(calculateTenGod('乙', '丁'), '食神');
        assert.equal(calculateTenGod('乙', '庚'), '正官');
        assert.equal(calculateTenGod('乙', '辛'), '七杀');

        // 丙(阳火)日主
        assert.equal(calculateTenGod('丙', '甲'), '偏印');
        assert.equal(calculateTenGod('丙', '壬'), '七杀');
        assert.equal(calculateTenGod('丙', '癸'), '正官');
    });

    it('同五行不同阴阳的区分', () => {
        assert.equal(calculateTenGod('庚', '辛'), '劫财');
        assert.equal(calculateTenGod('辛', '庚'), '劫财');
        assert.equal(calculateTenGod('庚', '庚'), '比肩');
    });
});

// ===== 2. 五行生克关系 =====

describe('STEM_ELEMENTS 和 BRANCH_ELEMENTS', () => {
    it('天干五行对应正确', () => {
        assert.equal(STEM_ELEMENTS['甲'], '木');
        assert.equal(STEM_ELEMENTS['乙'], '木');
        assert.equal(STEM_ELEMENTS['丙'], '火');
        assert.equal(STEM_ELEMENTS['丁'], '火');
        assert.equal(STEM_ELEMENTS['戊'], '土');
        assert.equal(STEM_ELEMENTS['己'], '土');
        assert.equal(STEM_ELEMENTS['庚'], '金');
        assert.equal(STEM_ELEMENTS['辛'], '金');
        assert.equal(STEM_ELEMENTS['壬'], '水');
        assert.equal(STEM_ELEMENTS['癸'], '水');
    });

    it('天干五行覆盖全部十天干', () => {
        for (const stem of TIAN_GAN) {
            assert.ok(STEM_ELEMENTS[stem], `天干 ${stem} 应有五行映射`);
        }
    });

    it('地支五行对应正确', () => {
        assert.equal(BRANCH_ELEMENTS['子'], '水');
        assert.equal(BRANCH_ELEMENTS['丑'], '土');
        assert.equal(BRANCH_ELEMENTS['寅'], '木');
        assert.equal(BRANCH_ELEMENTS['卯'], '木');
        assert.equal(BRANCH_ELEMENTS['辰'], '土');
        assert.equal(BRANCH_ELEMENTS['巳'], '火');
        assert.equal(BRANCH_ELEMENTS['午'], '火');
        assert.equal(BRANCH_ELEMENTS['未'], '土');
        assert.equal(BRANCH_ELEMENTS['申'], '金');
        assert.equal(BRANCH_ELEMENTS['酉'], '金');
        assert.equal(BRANCH_ELEMENTS['戌'], '土');
        assert.equal(BRANCH_ELEMENTS['亥'], '水');
    });

    it('地支五行覆盖全部十二地支', () => {
        for (const branch of DI_ZHI) {
            assert.ok(BRANCH_ELEMENTS[branch], `地支 ${branch} 应有五行映射`);
        }
    });
});

// ===== 3. 六合表 (LIU_HE_TABLE) =====

describe('LIU_HE_TABLE', () => {
    it('午未合化结果为土', () => {
        // 午未合，传统命理合化为土
        assert.equal(LIU_HE_TABLE['午'].partner, '未');
        assert.equal(LIU_HE_TABLE['午'].result, '土', '午未合化应为土');
        assert.equal(LIU_HE_TABLE['未'].partner, '午');
        assert.equal(LIU_HE_TABLE['未'].result, '土', '未午合化应为土');
    });

    it('子丑合土', () => {
        assert.equal(LIU_HE_TABLE['子'].partner, '丑');
        assert.equal(LIU_HE_TABLE['子'].result, '土');
    });

    it('寅亥合木', () => {
        assert.equal(LIU_HE_TABLE['寅'].partner, '亥');
        assert.equal(LIU_HE_TABLE['寅'].result, '木');
    });

    it('卯戌合火', () => {
        assert.equal(LIU_HE_TABLE['卯'].partner, '戌');
        assert.equal(LIU_HE_TABLE['卯'].result, '火');
    });

    it('辰酉合金', () => {
        assert.equal(LIU_HE_TABLE['辰'].partner, '酉');
        assert.equal(LIU_HE_TABLE['辰'].result, '金');
    });

    it('巳申合水', () => {
        assert.equal(LIU_HE_TABLE['巳'].partner, '申');
        assert.equal(LIU_HE_TABLE['巳'].result, '水');
    });

    it('六合表双向对称', () => {
        for (const branch of DI_ZHI) {
            const entry = LIU_HE_TABLE[branch];
            const reverse = LIU_HE_TABLE[entry.partner];
            assert.equal(reverse.partner, branch, `${branch}与${entry.partner}应双向对称`);
            assert.equal(reverse.result, entry.result, `${branch}与${entry.partner}合化结果应一致`);
        }
    });
});

// ===== 4. 十二长生 (getDiShi) =====

describe('getDiShi 十二长生', () => {
    it('阳干甲：亥为长生，卯为帝旺（顺行）', () => {
        assert.equal(getDiShi('甲', '亥'), '长生');
        assert.equal(getDiShi('甲', '子'), '沐浴');
        assert.equal(getDiShi('甲', '丑'), '冠带');
        assert.equal(getDiShi('甲', '寅'), '临官');
        assert.equal(getDiShi('甲', '卯'), '帝旺');
        assert.equal(getDiShi('甲', '辰'), '衰');
        assert.equal(getDiShi('甲', '午'), '死');
        assert.equal(getDiShi('甲', '未'), '墓');
    });

    it('阴干乙：午为长生，寅为帝旺（逆行）', () => {
        assert.equal(getDiShi('乙', '午'), '长生');
        assert.equal(getDiShi('乙', '巳'), '沐浴');
        assert.equal(getDiShi('乙', '辰'), '冠带');
        assert.equal(getDiShi('乙', '卯'), '临官');
        assert.equal(getDiShi('乙', '寅'), '帝旺');
        assert.equal(getDiShi('乙', '丑'), '衰');
    });

    it('阳干丙/戊：寅为长生', () => {
        assert.equal(getDiShi('丙', '寅'), '长生');
        assert.equal(getDiShi('戊', '寅'), '长生');
        assert.equal(getDiShi('丙', '午'), '帝旺');
    });

    it('阳干庚：巳为长生', () => {
        assert.equal(getDiShi('庚', '巳'), '长生');
        assert.equal(getDiShi('庚', '酉'), '帝旺');
    });

    it('阳干壬：申为长生', () => {
        assert.equal(getDiShi('壬', '申'), '长生');
        assert.equal(getDiShi('壬', '子'), '帝旺');
    });

});

// ===== 5. 地支藏干 (HIDDEN_STEMS) =====

describe('HIDDEN_STEMS 地支藏干', () => {
    it('子藏癸', () => {
        assert.deepEqual(HIDDEN_STEMS['子'], ['癸']);
    });

    it('寅藏甲丙戊', () => {
        assert.deepEqual(HIDDEN_STEMS['寅'], ['甲', '丙', '戊']);
    });

    it('午藏丁己', () => {
        assert.deepEqual(HIDDEN_STEMS['午'], ['丁', '己']);
    });

    it('丑藏己癸辛', () => {
        assert.deepEqual(HIDDEN_STEMS['丑'], ['己', '癸', '辛']);
    });

    it('卯只藏乙（单一本气）', () => {
        assert.deepEqual(HIDDEN_STEMS['卯'], ['乙']);
    });

    it('酉只藏辛（单一本气）', () => {
        assert.deepEqual(HIDDEN_STEMS['酉'], ['辛']);
    });

    it('所有十二地支都有藏干', () => {
        for (const branch of DI_ZHI) {
            assert.ok(
                HIDDEN_STEMS[branch] && HIDDEN_STEMS[branch].length > 0,
                `地支 ${branch} 应有藏干`
            );
        }
    });

    it('藏干均为合法天干', () => {
        const validStems = new Set(TIAN_GAN);
        for (const branch of DI_ZHI) {
            for (const stem of HIDDEN_STEMS[branch]) {
                assert.ok(validStems.has(stem), `${branch}的藏干${stem}应为合法天干`);
            }
        }
    });
});

// ===== 6. calculateBaziChartBundle 集成测试 =====

describe('calculateBaziChartBundle 集成测试', () => {
    it('00:xx 早子时应保留为子时，不应退化为 12:xx 午时', () => {
        const base: BaziFormData = {
            name: '早子时测试',
            gender: 'male',
            birthYear: 2000,
            birthMonth: 1,
            birthDay: 1,
            birthHour: 0,
            birthMinute: 30,
            calendarType: 'solar',
            isLeapMonth: false,
        };

        const early = calculateBaziChartBundle(base).output;
        const noon = calculateBaziChartBundle({ ...base, birthHour: 12 }).output;

        assert.equal(early.fourPillars.hour.branch, '子');
        assert.equal(noon.fourPillars.hour.branch, '午');
        assert.notEqual(early.fourPillars.hour.stem, noon.fourPillars.hour.stem);
    });

    it('公历 1990-01-01 12:00 男 → 四柱计算正确', () => {
        const formData: BaziFormData = {
            name: '测试',
            gender: 'male',
            birthYear: 1990,
            birthMonth: 1,
            birthDay: 1,
            birthHour: 12,
            birthMinute: 0,
            calendarType: 'solar',
            isLeapMonth: false,
        };

        const { output: result } = calculateBaziChartBundle(formData);

        // 1990-01-01 公历 → 农历己巳年十一月初五
        // 八字：己巳 丙子 丙寅 甲午（lunar-javascript 排盘结果）
        assert.equal(result.fourPillars.year.stem, '己', '年干');
        assert.equal(result.fourPillars.year.branch, '巳', '年支');
        assert.equal(result.fourPillars.month.stem, '丙', '月干');
        assert.equal(result.fourPillars.month.branch, '子', '月支');
        assert.equal(result.fourPillars.day.stem, '丙', '日干');
        assert.equal(result.fourPillars.day.branch, '寅', '日支');
        assert.equal(result.fourPillars.hour.stem, '甲', '时干');
        assert.equal(result.fourPillars.hour.branch, '午', '时支');

        // 日主
        assert.equal(result.dayMaster, '丙');

        // 性别
        assert.equal(result.gender, 'male');

        // 日柱不应有十神
        assert.equal(result.fourPillars.day.tenGod, undefined);
    });

    it('四柱天干地支都能映射到正确五行属性', () => {
        const formData: BaziFormData = {
            name: '测试',
            gender: 'female',
            birthYear: 1990,
            birthMonth: 1,
            birthDay: 1,
            birthHour: 12,
            birthMinute: 0,
            calendarType: 'solar',
            isLeapMonth: false,
        };

        const { output: result } = calculateBaziChartBundle(formData);

        const pillars = [
            result.fourPillars.year,
            result.fourPillars.month,
            result.fourPillars.day,
            result.fourPillars.hour,
        ];
        for (const pillar of pillars) {
            assert.ok(STEM_ELEMENTS[pillar.stem], `${pillar.stem}应有五行映射`);
            assert.ok(BRANCH_ELEMENTS[pillar.branch], `${pillar.branch}应有五行映射`);
        }
    });

    it('五行统计不为空且总和大于0', () => {
        const formData: BaziFormData = {
            name: '测试',
            gender: 'male',
            birthYear: 1990,
            birthMonth: 1,
            birthDay: 1,
            birthHour: 12,
            birthMinute: 0,
            calendarType: 'solar',
            isLeapMonth: false,
        };

        const { output: result } = calculateBaziChartBundle(formData);
        const stats = calculateBaziFiveElementsStats(result.fourPillars);
        const total = stats.金 + stats.木 + stats.水 + stats.火 + stats.土;
        assert.ok(total > 0, '五行统计总和应大于0');
    });

    it('年月时柱有十神，日柱无十神', () => {
        const formData: BaziFormData = {
            name: '测试',
            gender: 'male',
            birthYear: 1990,
            birthMonth: 1,
            birthDay: 1,
            birthHour: 12,
            birthMinute: 0,
            calendarType: 'solar',
            isLeapMonth: false,
        };

        const { output: result } = calculateBaziChartBundle(formData);
        assert.ok(result.fourPillars.year.tenGod !== undefined, '年柱应有十神');
        assert.ok(result.fourPillars.month.tenGod !== undefined, '月柱应有十神');
        assert.equal(result.fourPillars.day.tenGod, undefined, '日柱不应有十神');
        assert.ok(result.fourPillars.hour.tenGod !== undefined, '时柱应有十神');
    });
});

describe('calculateShenSha 集成测试', () => {
    it('shared-core refactor should not leave runtime-only XUN_KONG references in web shensha calculation', () => {
        const formData: BaziFormData = {
            name: '测试',
            gender: 'male',
            birthYear: 1990,
            birthMonth: 1,
            birthDay: 1,
            birthHour: 12,
            birthMinute: 0,
            calendarType: 'solar',
            isLeapMonth: false,
        };

        const result = calculateShenSha(formData);

        assert.ok(result);
        assert.ok(Array.isArray(result.pillarShenSha.year));
        assert.ok(Array.isArray(result.pillarShenSha.month));
        assert.ok(Array.isArray(result.pillarShenSha.day));
        assert.ok(Array.isArray(result.pillarShenSha.hour));
    });
});

// ===== 7. 地支关系 =====

describe('地支关系', () => {
    it('六冲：子午冲', () => {
        assert.equal(LIU_CHONG_TABLE['子'], '午');
        assert.equal(LIU_CHONG_TABLE['午'], '子');
    });

    it('六冲：丑未冲', () => {
        assert.equal(LIU_CHONG_TABLE['丑'], '未');
        assert.equal(LIU_CHONG_TABLE['未'], '丑');
    });

    it('六冲：寅申冲', () => {
        assert.equal(LIU_CHONG_TABLE['寅'], '申');
        assert.equal(LIU_CHONG_TABLE['申'], '寅');
    });

    it('六冲表双向对称', () => {
        for (const branch of DI_ZHI) {
            const chong = LIU_CHONG_TABLE[branch];
            assert.equal(LIU_CHONG_TABLE[chong], branch, `${branch}冲${chong}应双向对称`);
        }
    });

    it('三合：申子辰合水局', () => {
        const waterSanHe = SAN_HE_TABLE.find(s => s.name === '申子辰合水局');
        assert.ok(waterSanHe, '应存在申子辰合水局');
        assert.deepEqual(waterSanHe!.branches, ['申', '子', '辰']);
        assert.equal(waterSanHe!.result, '水');
    });

    it('三合：亥卯未合木局', () => {
        const woodSanHe = SAN_HE_TABLE.find(s => s.name === '亥卯未合木局');
        assert.ok(woodSanHe);
        assert.equal(woodSanHe!.result, '木');
    });

    it('三合：寅午戌合火局', () => {
        const fireSanHe = SAN_HE_TABLE.find(s => s.name === '寅午戌合火局');
        assert.ok(fireSanHe);
        assert.equal(fireSanHe!.result, '火');
    });

    it('三合：巳酉丑合金局', () => {
        const metalSanHe = SAN_HE_TABLE.find(s => s.name === '巳酉丑合金局');
        assert.ok(metalSanHe);
        assert.equal(metalSanHe!.result, '金');
    });

    it('六合：子丑合土', () => {
        assert.equal(LIU_HE_TABLE['子'].partner, '丑');
        assert.equal(LIU_HE_TABLE['子'].result, '土');
    });

});

// ===== 8. 藏干权重 =====

describe('calculateFiveElements 藏干权重', () => {
    it('藏干对五行统计有贡献（权重 0.3）', () => {
        const formData: BaziFormData = {
            name: '测试',
            gender: 'male',
            birthYear: 1990,
            birthMonth: 1,
            birthDay: 1,
            birthHour: 12,
            birthMinute: 0,
            calendarType: 'solar',
            isLeapMonth: false,
        };

        const { output: result } = calculateBaziChartBundle(formData);
        const stats = calculateBaziFiveElementsStats(result.fourPillars);

        // 五行统计应包含小数（来自藏干的 0.3 权重）
        const allValues = [stats.金, stats.木, stats.水, stats.火, stats.土];
        const hasDecimal = allValues.some(v => v !== Math.floor(v));
        assert.ok(hasDecimal, '五行统计应包含小数值（藏干权重贡献）');
    });

    it('纯天干地支贡献为整数，藏干贡献为小数', () => {
        // 己巳 丙子 庚辰 壬午 的五行统计
        // 天干：己(土) 丙(火) 庚(金) 壬(水) → 土1 火1 金1 水1
        // 地支：巳(火) 子(水) 辰(土) 午(火) → 火2 水1 土1
        // 天干+地支整数部分：金1 木0 水2 火3 土2
        // 藏干会在此基础上增加 0.3 的倍数
        const formData: BaziFormData = {
            name: '测试',
            gender: 'male',
            birthYear: 1990,
            birthMonth: 1,
            birthDay: 1,
            birthHour: 12,
            birthMinute: 0,
            calendarType: 'solar',
            isLeapMonth: false,
        };

        const { output: result } = calculateBaziChartBundle(formData);
        const stats = calculateBaziFiveElementsStats(result.fourPillars);
        const total = stats.金 + stats.木 + stats.水 + stats.火 + stats.土;

        // 8个天干地支 + 藏干贡献，总和应大于8
        assert.ok(total > 8, `五行总和(${total})应大于8（含藏干贡献）`);
    });
});
