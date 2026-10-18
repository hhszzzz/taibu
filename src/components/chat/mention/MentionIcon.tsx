/**
 * 提及图标：统一取侧栏导航图标（知识库沿用书本图标），
 * 输入框镜像、消息气泡与编辑态共用。
 */
import type { MentionType } from '@/types';
import type { NavIcon } from '@/lib/navigation/registry';
import {
    BaziIcon, DaliurenIcon, DailyIcon, FaceIcon, HepanIcon, KnowledgeIcon, LiuyaoIcon,
    MbtiIcon, MeihuaIcon, MonthlyIcon, PalmIcon, QimenIcon, RecordsIcon, TarotIcon,
    XiaoliurenIcon, ZiweiIcon,
} from '@/lib/navigation/nav-icons';

/** 模块级映射：提及类型 → 侧边栏同源图标。 */
const MENTION_ICONS: Record<MentionType, NavIcon> = {
    knowledge_base: KnowledgeIcon,
    bazi_chart: BaziIcon,
    ziwei_chart: ZiweiIcon,
    tarot_reading: TarotIcon,
    liuyao_divination: LiuyaoIcon,
    face_reading: FaceIcon,
    palm_reading: PalmIcon,
    mbti_reading: MbtiIcon,
    hepan_chart: HepanIcon,
    ming_record: RecordsIcon,
    daily_fortune: DailyIcon,
    monthly_fortune: MonthlyIcon,
    qimen_chart: QimenIcon,
    daliuren_divination: DaliurenIcon,
    meihua_divination: MeihuaIcon,
    xiaoliuren_divination: XiaoliurenIcon,
};

export function MentionIcon({ type, size = 14 }: { type: MentionType; size?: number }) {
    const Icon = MENTION_ICONS[type];
    return <Icon size={size} />;
}
