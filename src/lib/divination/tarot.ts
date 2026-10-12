/**
 * Web 侧塔罗封装层
 *
 * 核心牌库、牌阵、抽牌与 canonical 输出统一复用 taibu-core/tarot。
 * Web 侧仅补充图片路径与少量展示文案 overlay。
 */

import {
    TAROT_CARDS as CORE_TAROT_CARDS,
    TAROT_SPREADS as CORE_TAROT_SPREADS,
    calculateTarot,
    toTarotJson,
    toTarotText,
    type TarotCanonicalJSON,
    type TarotCardDefinition,
    type TarotCardResult,
    type TarotOutput as CoreTarotOutput,
    type TarotSpreadDefinition,
} from 'taibu-core/tarot';
import { resolveChartTextDetailLevel, type ChartTextDetailLevel } from '@/lib/divination/detail-level';

export type TarotSuit = 'major' | 'wands' | 'cups' | 'swords' | 'pentacles';
export type CardOrientation = 'upright' | 'reversed';

export interface TarotCard {
    id: number;
    name: string;
    nameChinese: string;
    suit: TarotSuit;
    number: number;
    image: string;
    keywords: string[];
    uprightMeaning: string;
    reversedMeaning: string;
    element?: string;
    zodiac?: string;
    reversedKeywords?: string[];
}

export interface DrawnCard {
    card: TarotCard;
    orientation: CardOrientation;
    position?: string;
}

export interface TarotSpread {
    id: string;
    name: string;
    description: string;
    positions: { name: string; meaning: string }[];
    cardCount: number;
}

export interface TarotReading {
    id?: string;
    userId?: string;
    spreadId: string;
    spreadName: string;
    question?: string;
    cards: DrawnCard[];
    summary?: string;
    createdAt: Date;
}

export interface TarotNumerologyCard {
    number: number;
    name: string;
    nameChinese: string;
    year?: number;
}

export interface TarotNumerology {
    personalityCard: TarotNumerologyCard;
    soulCard: TarotNumerologyCard;
    yearlyCard: TarotNumerologyCard;
}

type TarotTextCardLike = {
    position?: string;
    orientation?: CardOrientation;
    meaning?: string;
    card?: {
        name?: string;
        nameChinese?: string;
        number?: number;
        element?: string;
        zodiac?: string;
        astrologicalCorrespondence?: string;
        keywords?: string[];
        reversedKeywords?: string[];
        uprightMeaning?: string;
        reversedMeaning?: string;
    };
};

type TarotDrawOptions = {
    seed?: string;
    seedScope?: string;
    question?: string;
    timezone?: string;
    birthDate?: string;
};

const TAROT_CARD_IMAGE_OVERRIDES: Partial<Record<string, string>> = {
    'The Lovers': '/tarot_cards/TheLovers.jpg',
};

const TAROT_CARD_LEGACY_NAME_ALIASES: Partial<Record<string, string[]>> = {
    'The Fool': ['愚人'],
    'The Empress': ['皇后'],
    'The Tower': ['高塔'],
};

const TAROT_SPREAD_DISPLAY_OVERRIDES: Record<string, Omit<TarotSpread, 'cardCount'>> = {
    single: {
        id: 'single',
        name: '单牌',
        description: '最简单的牌阵，抽一张牌获取当前情况的指引。',
        positions: [{ name: '当前指引', meaning: '代表当前情况最需要关注的信息' }],
    },
    'three-card': {
        id: 'three-card',
        name: '三牌阵',
        description: '经典牌阵，展示过去、现在、未来的发展脉络。',
        positions: [
            { name: '过去', meaning: '影响当前情况的过去因素' },
            { name: '现在', meaning: '当前情况的核心' },
            { name: '未来', meaning: '可能的发展方向' },
        ],
    },
    love: {
        id: 'love',
        name: '爱情牌阵',
        description: '专门解读感情问题的牌阵。',
        positions: [
            { name: '你的状态', meaning: '你在这段关系中的状态' },
            { name: '对方状态', meaning: '对方在这段关系中的状态' },
            { name: '关系现状', meaning: '两人关系的现状' },
            { name: '建议', meaning: '改善关系的建议' },
        ],
    },
    'celtic-cross': {
        id: 'celtic-cross',
        name: '凯尔特十字',
        description: '最经典全面的牌阵，深入分析复杂问题。',
        positions: [
            { name: '现状', meaning: '问题的核心' },
            { name: '挑战', meaning: '面临的主要障碍' },
            { name: '意识', meaning: '你意识到的方面' },
            { name: '潜意识', meaning: '隐藏的影响因素' },
            { name: '过去', meaning: '近期的影响' },
            { name: '未来', meaning: '近期可能的发展' },
            { name: '态度', meaning: '你对问题的态度' },
            { name: '环境', meaning: '外部影响因素' },
            { name: '希望与恐惧', meaning: '内心的期望与担忧' },
            { name: '结果', meaning: '最可能的结果' },
        ],
    },
    horseshoe: {
        id: 'horseshoe',
        name: '马蹄牌阵',
        description: '七张牌呈马蹄形展开，梳理障碍、外部环境与可能的结果。',
        positions: [
            { name: '过去', meaning: '影响当前情况的过去因素' },
            { name: '现在', meaning: '当前情况的核心' },
            { name: '潜在影响', meaning: '尚未显现但会起作用的因素' },
            { name: '障碍', meaning: '需要面对的主要阻碍' },
            { name: '外部环境', meaning: '周围的人与环境带来的影响' },
            { name: '建议', meaning: '可以采取的行动' },
            { name: '可能结果', meaning: '照目前发展最可能的结果' },
        ],
    },
    decision: {
        id: 'decision',
        name: '抉择牌阵',
        description: '在两个选项之间犹豫时，比较各自的走向与结果。',
        positions: [
            { name: '当前处境', meaning: '做选择时所处的状况' },
            { name: '选项A', meaning: '选择 A 时的状态' },
            { name: '选项B', meaning: '选择 B 时的状态' },
            { name: '选项A结果', meaning: '选择 A 的可能结果' },
            { name: '选项B结果', meaning: '选择 B 的可能结果' },
        ],
    },
    'mind-body-spirit': {
        id: 'mind-body-spirit',
        name: '身心灵',
        description: '从心智、身体、灵性三个层面观照当下的自己。',
        positions: [
            { name: '心智', meaning: '思绪与心理状态' },
            { name: '身体', meaning: '身体与现实层面的状态' },
            { name: '灵性', meaning: '内在成长与精神层面的指引' },
        ],
    },
    situation: {
        id: 'situation',
        name: '处境 · 障碍 · 建议',
        description: '理清卡住的地方：当前处境、阻碍与突破的方向。',
        positions: [
            { name: '处境', meaning: '当前所处的状况' },
            { name: '障碍', meaning: '阻碍你前进的因素' },
            { name: '建议', meaning: '突破困局的方向' },
        ],
    },
    'yes-no': {
        id: 'yes-no',
        name: '是否',
        description: '针对是非问题，给出一个明确的倾向。',
        positions: [{ name: '答案', meaning: '对所问之事的倾向' }],
    },
};

function parseBirthDateParts(birthDate?: string | null): { birthYear: number; birthMonth: number; birthDay: number } | null {
    if (!birthDate) return null;
    const normalized = birthDate.trim();
    if (!normalized) return null;
    const datePart = normalized.split('T')[0]?.split(' ')[0] ?? '';
    const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (!match) return null;
    const [, yearText, monthText, dayText] = match;
    const birthYear = Number(yearText);
    const birthMonth = Number(monthText);
    const birthDay = Number(dayText);
    if (!birthYear || birthMonth < 1 || birthMonth > 12 || birthDay < 1 || birthDay > 31) {
        return null;
    }
    return { birthYear, birthMonth, birthDay };
}

function buildMeaningText(
    orientation: CardOrientation,
    keywords: string[],
    reversedKeywords?: string[],
): string {
    if (orientation === 'upright') {
        return `正位：${keywords.join('、')}`;
    }
    if (reversedKeywords && reversedKeywords.length > 0) {
        return `逆位：${reversedKeywords.join('、')}`;
    }
    return `逆位：需要反思${keywords.join('、')}相关的问题`;
}

function resolveTarotCardNumber(card: TarotCardDefinition): number {
    if (typeof card.number === 'number') return card.number;

    const rank = card.name.split(' of ')[0];
    const rankToNumber: Record<string, number> = {
        Ace: 1,
        Two: 2,
        Three: 3,
        Four: 4,
        Five: 5,
        Six: 6,
        Seven: 7,
        Eight: 8,
        Nine: 9,
        Ten: 10,
        Page: 11,
        Knight: 12,
        Queen: 13,
        King: 14,
    };

    return rankToNumber[rank] ?? 0;
}

function resolveTarotCardImage(name: string): string {
    const overridden = TAROT_CARD_IMAGE_OVERRIDES[name];
    if (overridden) return overridden;
    const slug = name.toLowerCase().replace(/[^a-z]/gu, '');
    return `/tarot_cards/${slug}.jpeg`;
}

function mapCoreCardDefinitionToDisplay(card: TarotCardDefinition, index: number): TarotCard {
    return {
        id: index,
        name: card.name,
        nameChinese: card.nameChinese,
        suit: card.suit,
        number: resolveTarotCardNumber(card),
        image: resolveTarotCardImage(card.name),
        keywords: card.keywords,
        uprightMeaning: buildMeaningText('upright', card.keywords, card.reversedKeywords),
        reversedMeaning: buildMeaningText('reversed', card.keywords, card.reversedKeywords),
        element: card.element,
        zodiac: card.astrologicalCorrespondence,
        reversedKeywords: card.reversedKeywords,
    };
}

function mapCoreSpreadToDisplay(spread: TarotSpreadDefinition): TarotSpread | null {
    const overlay = TAROT_SPREAD_DISPLAY_OVERRIDES[spread.id];
    if (!overlay) return null;
    if (overlay.positions.length !== spread.positions.length) return null;
    return {
        ...overlay,
        cardCount: spread.positions.length,
    };
}

export const TAROT_CARDS: TarotCard[] = CORE_TAROT_CARDS.map(mapCoreCardDefinitionToDisplay);
export const TAROT_SPREADS: TarotSpread[] = CORE_TAROT_SPREADS
    .map(mapCoreSpreadToDisplay)
    .filter((spread): spread is TarotSpread => spread !== null);

const TAROT_CARD_INDEX_BY_NAME = new Map(TAROT_CARDS.map((card) => [card.name, card]));
const TAROT_CARD_INDEX_BY_CHINESE_NAME = new Map<string, TarotCard>();

for (let index = 0; index < TAROT_CARDS.length; index += 1) {
    const displayCard = TAROT_CARDS[index];
    const coreCard = CORE_TAROT_CARDS[index];
    TAROT_CARD_INDEX_BY_CHINESE_NAME.set(displayCard.nameChinese, displayCard);
    if (coreCard?.nameChinese) {
        TAROT_CARD_INDEX_BY_CHINESE_NAME.set(coreCard.nameChinese, displayCard);
    }
    for (const alias of TAROT_CARD_LEGACY_NAME_ALIASES[displayCard.name] ?? []) {
        TAROT_CARD_INDEX_BY_CHINESE_NAME.set(alias, displayCard);
    }
}

function resolveTarotCardBase(name: string): TarotCard | undefined {
    return TAROT_CARD_INDEX_BY_NAME.get(name);
}

export function findTarotCardByChineseName(name: string): TarotCard | undefined {
    return TAROT_CARD_INDEX_BY_CHINESE_NAME.get(name);
}

function resolveDateKey(date: Date, timeZone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const values: Record<string, string> = {};
    for (const part of parts) {
        if (part.type !== 'literal') {
            values[part.type] = part.value;
        }
    }
    return `${values.year}-${values.month}-${values.day}`;
}

function resolveLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function createEphemeralSeed(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        const values = new Uint32Array(2);
        globalThis.crypto.getRandomValues(values);
        return `rng-${values[0].toString(36)}-${values[1].toString(36)}`;
    }

    return `rng-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function resolveDrawSeed(seed?: string): string {
    return seed ?? createEphemeralSeed();
}

function mapCoreCardToDrawn(card: TarotCardResult, position?: string): DrawnCard {
    const base = resolveTarotCardBase(card.card.name);
    const keywords = base?.keywords ?? card.card.keywords;
    const reversedKeywords = base?.reversedKeywords ?? card.reversedKeywords;

    return {
        card: {
            id: base?.id ?? (card.number ?? 0),
            name: card.card.name,
            nameChinese: base?.nameChinese ?? card.card.nameChinese,
            suit: base?.suit ?? 'major',
            number: base?.number ?? card.number ?? 0,
            image: base?.image ?? resolveTarotCardImage(card.card.name),
            keywords,
            reversedKeywords,
            uprightMeaning: buildMeaningText('upright', keywords, reversedKeywords),
            reversedMeaning: buildMeaningText('reversed', keywords, reversedKeywords),
            element: card.element ?? base?.element,
            zodiac: card.astrologicalCorrespondence ?? base?.zodiac,
        },
        orientation: card.orientation,
        position,
    };
}

function mapCoreNumerologyCard(card: {
    number: number;
    name: string;
    nameChinese: string;
    year?: number;
}): TarotNumerologyCard {
    const base = resolveTarotCardBase(card.name);
    return {
        number: card.number,
        name: card.name,
        nameChinese: base?.nameChinese ?? card.nameChinese,
        year: card.year,
    };
}

function mapCoreNumerology(
    numerology: CoreTarotOutput['numerology'],
): TarotNumerology | undefined {
    if (!numerology) return undefined;
    return {
        personalityCard: mapCoreNumerologyCard(numerology.personalityCard),
        soulCard: mapCoreNumerologyCard(numerology.soulCard),
        yearlyCard: mapCoreNumerologyCard(numerology.yearlyCard),
    };
}

function buildTarotCanonicalPayload(input: {
    spreadName: string;
    spreadId?: string;
    question?: string | null;
    cards: unknown;
    seed?: string;
    numerology?: TarotNumerology | null;
    birthDate?: string | null;
}) {
    const cards = Array.isArray(input.cards) ? input.cards as TarotTextCardLike[] : [];
    const birthDateText = typeof input.birthDate === 'string' ? input.birthDate.trim() : '';
    const normalizedBirth = birthDateText ? parseBirthDateParts(birthDateText) : null;
    const normalizedBirthText = normalizedBirth
        ? `${normalizedBirth.birthYear}-${String(normalizedBirth.birthMonth).padStart(2, '0')}-${String(normalizedBirth.birthDay).padStart(2, '0')}`
        : birthDateText;

    const result: CoreTarotOutput = {
        spreadId: input.spreadId || 'custom',
        spreadName: input.spreadName,
        question: input.question || undefined,
        seed: input.seed || '',
        cards: cards.map((item, index) => {
            const card = item.card || {};
            return {
                position: item.position || `第${index + 1}张`,
                card: {
                    name: card.name || `第${index + 1}张`,
                    nameChinese: card.nameChinese || card.name || `第${index + 1}张`,
                    keywords: Array.isArray(card.keywords) ? card.keywords : [],
                },
                orientation: item.orientation === 'reversed' ? 'reversed' : 'upright',
                meaning: item.meaning || (item.orientation === 'reversed' ? card.reversedMeaning : card.uprightMeaning) || '',
                number: typeof card.number === 'number' ? card.number : undefined,
                reversedKeywords: Array.isArray(card.reversedKeywords) ? card.reversedKeywords : undefined,
                element: card.element,
                astrologicalCorrespondence: card.astrologicalCorrespondence || card.zodiac,
            };
        }),
        numerology: input.numerology || undefined,
    };

    return {
        result,
        birthDate: normalizedBirthText,
    };
}

export function generateTarotReadingText(input: {
    spreadName: string;
    spreadId?: string;
    question?: string | null;
    cards: unknown;
    seed?: string;
    numerology?: TarotNumerology | null;
    birthDate?: string | null;
    detailLevel?: ChartTextDetailLevel;
}): string {
    const { result, birthDate: normalizedBirthText } = buildTarotCanonicalPayload(input);
    return toTarotText(result, {
        birthDate: normalizedBirthText || undefined,
        detailLevel: input.detailLevel
            ? resolveChartTextDetailLevel('tarot', input.detailLevel)
            : (normalizedBirthText || input.numerology ? 'full' : 'default'),
    });
}

export function buildTarotCanonicalJSON(input: {
    spreadName: string;
    spreadId?: string;
    question?: string | null;
    cards: unknown;
    seed?: string;
    numerology?: TarotNumerology | null;
    birthDate?: string | null;
    detailLevel?: 'default' | 'full';
}) {
    const { result, birthDate } = buildTarotCanonicalPayload(input);
    return toTarotJson(result, {
        birthDate: birthDate || undefined,
        detailLevel: input.detailLevel ?? (birthDate || input.numerology ? 'full' : 'default'),
    }) as TarotCanonicalJSON;
}

export async function drawCards(
    count: number = 1,
    allowReversed: boolean = true,
    options: TarotDrawOptions = {},
): Promise<DrawnCard[]> {
    const safeCount = Math.max(1, Math.min(10, count));
    const spreadType = safeCount <= 1 ? 'single' : 'celtic-cross';
    const birthParts = parseBirthDateParts(options.birthDate);
    const output = await calculateTarot({
        spreadType,
        allowReversed,
        seed: resolveDrawSeed(options.seed),
        seedScope: options.seedScope,
        question: options.question,
        ...birthParts,
    });
    return output.cards.slice(0, safeCount).map((card) => mapCoreCardToDrawn(card));
}

export async function drawForSpread(
    spreadId: string,
    allowReversed: boolean = true,
    options: TarotDrawOptions = {},
): Promise<{ spread: TarotSpread; cards: DrawnCard[]; numerology?: TarotNumerology; seed: string } | null> {
    const spread = TAROT_SPREADS.find((item) => item.id === spreadId);
    if (!spread) return null;

    const birthParts = parseBirthDateParts(options.birthDate);
    const output = await calculateTarot({
        spreadType: spreadId,
        allowReversed,
        seed: resolveDrawSeed(options.seed),
        seedScope: options.seedScope,
        question: options.question,
        ...birthParts,
    });

    return {
        spread,
        cards: output.cards.map((card, index) => mapCoreCardToDrawn(card, spread.positions[index]?.meaning)),
        numerology: mapCoreNumerology(output.numerology),
        seed: output.seed,
    };
}

export async function getDailyCard(
    date: Date = new Date(),
    options: TarotDrawOptions = {},
): Promise<DrawnCard> {
    let seed: string;
    if (!options.timezone) {
        seed = resolveLocalDateKey(date);
    } else {
        try {
            seed = resolveDateKey(date, options.timezone);
        } catch (error) {
            if (error instanceof RangeError) {
                throw new Error('timezone 无效');
            }
            throw error;
        }
    }

    const output = await calculateTarot({
        spreadType: 'single',
        allowReversed: true,
        seed,
        seedScope: options.seedScope,
    });
    return mapCoreCardToDrawn(output.cards[0]);
}

export function getCardById(id: number): TarotCard | undefined {
    return TAROT_CARDS.find((card) => card.id === id);
}
