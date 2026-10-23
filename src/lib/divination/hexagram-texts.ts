/**
 * 六十四卦卦辞/爻辞库
 *
 * 文本正文统一复用 core；
 * web 侧仅保留 emphasis / timing 这类展示补充元数据。
 */
import {
    GUA_CI as HEXAGRAM_GUA_CI_FALLBACK,
    XIANG_CI as HEXAGRAM_XIANG_CI_FALLBACK,
    YAO_CI as HEXAGRAM_YAO_CI_FALLBACK,
} from 'taibu-core/data/hexagrams';

export interface YaoText {
    position: number;
    name: string;
    text: string;
    emphasis: 'low' | 'medium' | 'high';
    timing?: string;
}

export interface HexagramText {
    name: string;
    gua: string;
    xiang: string;
    yao: YaoText[];
}

type YaoMetaOverride = Pick<YaoText, 'position'> & Partial<Pick<YaoText, 'emphasis' | 'timing'>>;

const HEXAGRAM_META_OVERRIDES: Record<string, YaoMetaOverride[]> = {
    '乾为天': [
        { position: 1, timing: '时机未到' },
        { position: 2, emphasis: 'high', timing: '初显头角' },
        { position: 4, timing: '进退皆宜' },
        { position: 5, emphasis: 'high', timing: '大展宏图' },
        { position: 6, emphasis: 'high', timing: '盛极必衰' },
    ],
    '坤为地': [
        { position: 1, timing: '渐进之象' },
        { position: 2, emphasis: 'high' },
        { position: 4, emphasis: 'low' },
        { position: 5, emphasis: 'high', timing: '中正吉祥' },
        { position: 6, emphasis: 'high', timing: '过刚则折' },
    ],
    '水雷屯': [
        { position: 1, timing: '稳扎稳打' },
        { position: 2, emphasis: 'high', timing: '十年' },
        { position: 4, emphasis: 'high', timing: '适时而动' },
        { position: 6, emphasis: 'low', timing: '困顿之象' },
    ],
    '山水蒙': [
        { position: 2, emphasis: 'high' },
        { position: 3, emphasis: 'low' },
        { position: 4, emphasis: 'low' },
        { position: 5, emphasis: 'high', timing: '虚心求教' },
    ],
    '水天需': [
        { position: 1, timing: '耐心等待' },
        { position: 3, emphasis: 'low' },
        { position: 4, timing: '险中求安' },
        { position: 5, emphasis: 'high', timing: '从容待时' },
    ],
    '天水讼': [
        { position: 1, timing: '及早收手' },
        { position: 3, emphasis: 'low' },
        { position: 4, emphasis: 'high', timing: '知退为进' },
        { position: 5, emphasis: 'high' },
        { position: 6, emphasis: 'low', timing: '得而复失' },
    ],
    '地水师': [
        { position: 1, emphasis: 'high', timing: '纪律为先' },
        { position: 2, emphasis: 'high' },
        { position: 3, emphasis: 'low' },
        { position: 4, timing: '暂时退守' },
        { position: 6, emphasis: 'high', timing: '论功行赏' },
    ],
    '水地比': [
        { position: 1, emphasis: 'high', timing: '诚信为本' },
        { position: 2, emphasis: 'high' },
        { position: 3, emphasis: 'low' },
        { position: 5, emphasis: 'high', timing: '宽宏大量' },
        { position: 6, emphasis: 'low', timing: '无所依附' },
    ],
    '地天泰': [
        { position: 1, emphasis: 'high', timing: '携手同进' },
        { position: 2, emphasis: 'high' },
        { position: 3, timing: '盛极思危' },
        { position: 5, emphasis: 'high', timing: '大吉大利' },
        { position: 6, emphasis: 'low', timing: '泰极否来' },
    ],
    '天地否': [
        { position: 1, timing: '守正待时' },
        { position: 3, emphasis: 'low' },
        { position: 4, emphasis: 'high', timing: '否极泰来' },
        { position: 5, emphasis: 'high', timing: '居安思危' },
        { position: 6, emphasis: 'high', timing: '否终则泰' },
    ],
    '坎为水': [
        { position: 1, emphasis: 'low', timing: '险上加险' },
        { position: 3, emphasis: 'low' },
        { position: 4, timing: '诚心化险' },
        { position: 5, emphasis: 'high', timing: '险中求安' },
        { position: 6, emphasis: 'low', timing: '三年' },
    ],
    '离为火': [
        { position: 1, timing: '谨慎开始' },
        { position: 2, emphasis: 'high', timing: '中正吉祥' },
        { position: 3, emphasis: 'low', timing: '日暮途穷' },
        { position: 4, emphasis: 'low' },
        { position: 5, emphasis: 'high', timing: '忧患意识' },
    ],
    '水火既济': [
        { position: 1, timing: '谨慎前行' },
        { position: 2, emphasis: 'high', timing: '七日' },
        { position: 3, timing: '三年' },
        { position: 5, emphasis: 'high', timing: '诚心为要' },
        { position: 6, emphasis: 'low', timing: '过犹不及' },
    ],
    '火水未济': [
        { position: 1, emphasis: 'low' },
        { position: 2, emphasis: 'high', timing: '稳步前进' },
        { position: 4, emphasis: 'high', timing: '三年' },
        { position: 5, emphasis: 'high', timing: '光明正大' },
    ],
    '风天小畜': [
        { position: 2, emphasis: 'high' },
        { position: 3, emphasis: 'low' },
        { position: 5, emphasis: 'high' },
        { position: 6, timing: '月望' },
    ],
    '天泽履': [
        { position: 1, timing: '朴素前行' },
        { position: 2, emphasis: 'high' },
        { position: 3, emphasis: 'low' },
        { position: 4, emphasis: 'high', timing: '谨慎则吉' },
        { position: 6, emphasis: 'high', timing: '善始善终' },
    ],
    '雷地豫': [
        { position: 1, emphasis: 'low' },
        { position: 2, emphasis: 'high', timing: '当机立断' },
        { position: 3, emphasis: 'low' },
        { position: 4, emphasis: 'high' },
        { position: 6, timing: '迷途知返' },
    ],
    '山天大畜': [
        { position: 1, timing: '暂停积累' },
        { position: 3, emphasis: 'high', timing: '厚积薄发' },
        { position: 4, emphasis: 'high' },
        { position: 5, emphasis: 'high' },
        { position: 6, emphasis: 'high', timing: '大道畅通' },
    ],
    '泽火革': [
        { position: 1, timing: '巩固基础' },
        { position: 2, emphasis: 'high', timing: '时机成熟' },
        { position: 3, timing: '三思后行' },
        { position: 4, emphasis: 'high', timing: '改革得宜' },
        { position: 5, emphasis: 'high', timing: '大刀阔斧' },
    ],
    '火风鼎': [
        { position: 2, emphasis: 'high' },
        { position: 3, timing: '终吉' },
        { position: 4, emphasis: 'low' },
        { position: 5, emphasis: 'high', timing: '得遇贵人' },
        { position: 6, emphasis: 'high', timing: '大吉大利' },
    ],
    '震为雷': [
        { position: 1, emphasis: 'high', timing: '先惊后喜' },
        { position: 2, timing: '七日' },
        { position: 4, emphasis: 'low' },
        { position: 6, emphasis: 'low' },
    ],
    '艮为山': [
        { position: 1, timing: '止于初始' },
        { position: 3, emphasis: 'low' },
        { position: 4, emphasis: 'high' },
        { position: 5, emphasis: 'high', timing: '慎言' },
        { position: 6, emphasis: 'high', timing: '止于至善' },
    ],
    '巽为风': [
        { position: 2, emphasis: 'high' },
        { position: 3, emphasis: 'low' },
        { position: 4, emphasis: 'high', timing: '收获丰厚' },
        { position: 5, emphasis: 'high', timing: '三日' },
        { position: 6, emphasis: 'low' },
    ],
    '兑为泽': [
        { position: 1, emphasis: 'high', timing: '和悦吉祥' },
        { position: 2, emphasis: 'high' },
        { position: 3, emphasis: 'low' },
    ],
};

const parseFallbackYaoTexts = (lines: string[]): YaoText[] => {
    return lines.map((line, index) => {
        const position = index + 1;
        const splitIndex = line.indexOf('：');

        if (splitIndex < 0) {
            return {
                position,
                name: `第${position}爻`,
                text: line.trim(),
                emphasis: 'medium',
            };
        }

        return {
            position,
            name: line.slice(0, splitIndex).trim(),
            text: line.slice(splitIndex + 1).trim(),
            emphasis: 'medium',
        };
    });
};

const mergeYaoMeta = (base: YaoText[], override: YaoMetaOverride[] = []): YaoText[] => {
    const overrideMap = new Map(override.map((item) => [item.position, item]));

    return base.map((item) => {
        const enriched = overrideMap.get(item.position);
        if (!enriched) return item;
        return {
            ...item,
            emphasis: enriched.emphasis ?? item.emphasis,
            timing: enriched.timing ?? item.timing,
        };
    });
};

function buildHexagramText(name: string): HexagramText | undefined {
    const gua = HEXAGRAM_GUA_CI_FALLBACK[name];
    const xiang = HEXAGRAM_XIANG_CI_FALLBACK[name];
    const yaoLines = HEXAGRAM_YAO_CI_FALLBACK[name];

    if (!gua || !xiang || !yaoLines) {
        return undefined;
    }

    return {
        name,
        gua,
        xiang,
        yao: mergeYaoMeta(parseFallbackYaoTexts(yaoLines), HEXAGRAM_META_OVERRIDES[name]),
    };
}

const computedHexagramTexts: Record<string, HexagramText> = {};
for (const name of Object.keys(HEXAGRAM_GUA_CI_FALLBACK)) {
    const text = buildHexagramText(name);
    if (text) {
        computedHexagramTexts[name] = text;
    }
}

export const HEXAGRAM_TEXTS: Record<string, HexagramText> = computedHexagramTexts;

export function getHexagramText(name: string): HexagramText | undefined {
    return HEXAGRAM_TEXTS[name];
}

export function getYaoText(hexagramName: string, position: number): YaoText | undefined {
    return HEXAGRAM_TEXTS[hexagramName]?.yao.find((item) => item.position === position);
}
