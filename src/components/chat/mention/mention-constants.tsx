/**
 * MentionPopover 共享类型、常量与工具函数
 */
import type { ReactNode } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import type { MentionType } from '@/types';
import {
    BaziIcon, DaliurenIcon, DailyIcon, FaceIcon, HepanIcon, KnowledgeIcon, LiuyaoIcon,
    MbtiIcon, MeihuaIcon, MonthlyIcon, PalmIcon, QimenIcon, RecordsIcon, TarotIcon,
    XiaoliurenIcon, ZiweiIcon,
} from '@/lib/navigation/nav-icons';
import type { DataSourceSummary, DataSourceLoadError } from '@/lib/data-sources/types';
import type { KnowledgeBaseSummary } from '@/components/chat/composer/useComposerState';

export type { DataSourceSummary, DataSourceLoadError, KnowledgeBaseSummary };

// ---- Data types ----

export type ViewItem = {
    key: string;
    label: string;
    hint?: string;
    icon: ReactNode;
    raw?: DataSourceSummary | KnowledgeBaseSummary;
    disabled?: boolean;
};

export type ViewModel = {
    title: string;
    items: ViewItem[];
};

export type { MentionNavigationLevel as Level, MentionNavigationState as MentionPopoverState } from './mention-navigation';

// ---- Config maps ----

export const TYPE_LABELS: Record<MentionType, string> = {
    knowledge_base: '知识库',
    bazi_chart: '八字',
    ziwei_chart: '紫微',
    tarot_reading: '塔罗',
    liuyao_divination: '六爻',
    face_reading: '面相',
    palm_reading: '手相',
    mbti_reading: 'MBTI',
    hepan_chart: '合盘',
    ming_record: '命理记录',
    daily_fortune: '今日运势',
    monthly_fortune: '月运',
    qimen_chart: '奇门遁甲',
    daliuren_divination: '大六壬',
    meihua_divination: '梅花易数',
    xiaoliuren_divination: '小六壬',
};

/** 提及图标 = 侧栏导航同一套单线图标（20px 槽位、24 网格）。 */
const mentionNavIcon = (Icon: (props: { className?: string; size?: number | string }) => ReactNode) =>
    <Icon className="w-5 h-5" />;

export const TYPE_ICONS: Record<MentionType, ReactNode> = {
    knowledge_base: mentionNavIcon(KnowledgeIcon),
    bazi_chart: mentionNavIcon(BaziIcon),
    ziwei_chart: mentionNavIcon(ZiweiIcon),
    tarot_reading: mentionNavIcon(TarotIcon),
    liuyao_divination: mentionNavIcon(LiuyaoIcon),
    face_reading: mentionNavIcon(FaceIcon),
    palm_reading: mentionNavIcon(PalmIcon),
    mbti_reading: mentionNavIcon(MbtiIcon),
    hepan_chart: mentionNavIcon(HepanIcon),
    ming_record: mentionNavIcon(RecordsIcon),
    daily_fortune: mentionNavIcon(DailyIcon),
    monthly_fortune: mentionNavIcon(MonthlyIcon),
    qimen_chart: mentionNavIcon(QimenIcon),
    daliuren_divination: mentionNavIcon(DaliurenIcon),
    meihua_divination: mentionNavIcon(MeihuaIcon),
    xiaoliuren_divination: mentionNavIcon(XiaoliurenIcon),
};

export const HEPAN_TYPE_LABELS: Record<string, string> = {
    love: '情侣合婚',
    business: '商业合伙',
    family: '亲子关系',
};

export const HEPAN_TYPE_ICONS: Record<string, ReactNode> = {
    love: mentionNavIcon(HepanIcon),
    business: mentionNavIcon(HepanIcon),
    family: mentionNavIcon(HepanIcon),
};

export const FOLDER_ICON = <Folder className="w-4 h-4" />;
export const KB_ICON = mentionNavIcon(KnowledgeIcon);
export const CHEVRON_ICON = <ChevronRight className="w-4 h-4 opacity-50" />;

// ---- Helpers ----

export const getHepanSubtype = (item: DataSourceSummary): 'love' | 'business' | 'family' | null => {
    if (item.hepanType === 'love' || item.hepanType === 'business' || item.hepanType === 'family') {
        return item.hepanType;
    }
    return null;
};

export const shouldShowHint = (item: DataSourceSummary) => {
    if (item.type === 'bazi_chart' || item.type === 'ziwei_chart') return false;
    if (item.type === 'tarot_reading' || item.type === 'liuyao_divination') {
        return item.preview.startsWith('问题：');
    }
    return true;
};

export function normalizeQuery(raw: string) {
    const q = raw.trim().toLowerCase();
    if (!q) return '';
    return q
        .replace(/^(?:d|data|数|数据)\s*/i, '')
        .replace(/^(?:k|kb|knowledge|知|知识库)\s*/i, '');
}

export function getQueryHint(raw: string): 'data' | 'knowledge' | null {
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    if (/^(?:d|data|数|数据)\b/i.test(q)) return 'data';
    if (/^(?:k|kb|knowledge|知|知识库)\b/i.test(q)) return 'knowledge';
    return null;
}
