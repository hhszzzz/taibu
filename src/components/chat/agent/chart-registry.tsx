/**
 * 占术图标注册表：所有占术图标统一取自侧边栏导航图标（nav-icons），
 * 侧栏、成果、工作区标签、概览、@ 提及与聊天步骤共用同一套。
 *
 * 'use client' 标记说明：
 * - 图标为客户端组件，随会话栏渲染
 */
'use client';

import type { AgentChartKind } from '@/lib/agent/tool-catalog';
import { AGENT_CHART_SHORT_NAMES } from '@/lib/agent/tool-catalog';
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
    bazi: { icon: BaziIcon, label: AGENT_CHART_SHORT_NAMES.bazi },
    ziwei: { icon: ZiweiIcon, label: AGENT_CHART_SHORT_NAMES.ziwei },
    qimen: { icon: QimenIcon, label: AGENT_CHART_SHORT_NAMES.qimen },
    liuyao: { icon: LiuyaoIcon, label: AGENT_CHART_SHORT_NAMES.liuyao },
    meihua: { icon: MeihuaIcon, label: AGENT_CHART_SHORT_NAMES.meihua },
    daliuren: { icon: DaliurenIcon, label: AGENT_CHART_SHORT_NAMES.daliuren },
    xiaoliuren: { icon: XiaoliurenIcon, label: AGENT_CHART_SHORT_NAMES.xiaoliuren },
    tarot: { icon: TarotIcon, label: AGENT_CHART_SHORT_NAMES.tarot },
    taiyi: { icon: TaiyiIcon, label: AGENT_CHART_SHORT_NAMES.taiyi },
    astrology: { icon: AstrologyIcon, label: AGENT_CHART_SHORT_NAMES.astrology },
    almanac: { icon: DailyIcon, label: AGENT_CHART_SHORT_NAMES.almanac },
};

export function getChartKindMeta(kind: string | null | undefined): ChartKindMeta {
    return kind && kind in CHART_KIND_META ? CHART_KIND_META[kind as AgentChartKind] : CHART_KIND_META.bazi;
}
