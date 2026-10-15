import { STEM_ELEMENTS, ZHI_WUXING } from 'taibu-core/utils';
import type { EarthlyBranch, FiveElement, HeavenlyStem } from '@/types';

const STEM_ELEMENTS_MAP = STEM_ELEMENTS as Record<HeavenlyStem, FiveElement>;
const BRANCH_ELEMENTS_MAP = ZHI_WUXING as Record<EarthlyBranch, FiveElement>;

const BRIGHTNESS_COLORS: Record<string, string> = {
    '庙': '#FFD700',
    '旺': '#FF8C00',
    '得': '#32CD32',
    '利': '#4169E1',
    '平': '#808080',
    '不': '#CD853F',
    '陷': '#DC143C',
};

const MUTAGEN_COLORS: Record<string, string> = {
    '禄': '#FFD700',
    '权': '#FF4500',
    '科': '#4169E1',
    '忌': '#2F4F4F',
};

export function getStemElement(stem: string): FiveElement | null {
    return STEM_ELEMENTS_MAP[stem as HeavenlyStem] || null;
}

export function getBranchElement(branch: string): FiveElement | null {
    return BRANCH_ELEMENTS_MAP[branch as EarthlyBranch] || null;
}

const ELEMENT_COLOR_TOKENS: Record<FiveElement, { token: string; fallback: string }> = {
    '金': { token: '--element-metal', fallback: '#FFD700' },
    '木': { token: '--element-wood', fallback: '#228B22' },
    '水': { token: '--element-water', fallback: '#1E90FF' },
    '火': { token: '--element-fire', fallback: '#FF4500' },
    '土': { token: '--element-earth', fallback: '#8B4513' },
};

/**
 * Inline-style color for an element. Surfaces that define the --element-* tokens
 * (the chat workspace uses an accessible palette with dark variants) override
 * the historical colors; every other page keeps the fallback.
 */
export function getElementColor(element: FiveElement): string {
    const { token, fallback } = ELEMENT_COLOR_TOKENS[element];
    return `var(${token}, ${fallback})`;
}

export function getElementLightColor(element: FiveElement): string {
    const colors: Record<FiveElement, string> = {
        '金': '#FFF8DC',
        '木': '#90EE90',
        '水': '#ADD8E6',
        '火': '#FFA07A',
        '土': '#DEB887',
    };
    return colors[element];
}

export function getBrightnessColor(brightness?: string): string {
    return BRIGHTNESS_COLORS[brightness || ''] || '#808080';
}

export function getMutagenColor(mutagen?: string): string {
    return MUTAGEN_COLORS[mutagen || ''] || 'transparent';
}
