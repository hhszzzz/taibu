/**
 * 占术图标注册表：所有占术图标统一取自侧边栏导航图标（nav-icons），
 * 侧栏、成果、工作区标签、概览、@ 提及与聊天步骤共用同一套。
 *
 * 'use client' 标记说明：
 * - 图标为客户端组件，随会话栏渲染
 */
'use client';

import type { AgentChartKind } from '@/lib/agent/tool-catalog';
import type { NavIcon } from '@/lib/navigation/registry';
import {
    AstrologyIcon, BaziIcon, DaliurenIcon, DailyIcon, LiuyaoIcon, MeihuaIcon, QimenIcon,
    TaiyiIcon, TarotIcon, XiaoliurenIcon, ZiweiIcon,
} from '@/lib/navigation/nav-icons';

export interface ChartKindMeta {
    icon: NavIcon;
    /** 侧栏与标签用的短名。 */
    label: string;
}

export const CHART_KIND_META: Record<AgentChartKind, ChartKindMeta> = {
    bazi: { icon: BaziIcon, label: '八字' },
    ziwei: { icon: ZiweiIcon, label: '紫微' },
    qimen: { icon: QimenIcon, label: '奇门' },
    liuyao: { icon: LiuyaoIcon, label: '六爻' },
    meihua: { icon: MeihuaIcon, label: '梅花' },
    daliuren: { icon: DaliurenIcon, label: '大六壬' },
    xiaoliuren: { icon: XiaoliurenIcon, label: '小六壬' },
    tarot: { icon: TarotIcon, label: '塔罗' },
    taiyi: { icon: TaiyiIcon, label: '太乙' },
    astrology: { icon: AstrologyIcon, label: '占星' },
    almanac: { icon: DailyIcon, label: '黄历' },
};

export function getChartKindMeta(kind: string | null | undefined): ChartKindMeta {
    return kind && kind in CHART_KIND_META ? CHART_KIND_META[kind as AgentChartKind] : CHART_KIND_META.bazi;
}
