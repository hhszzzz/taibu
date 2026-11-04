/**
 * 对话分组共享常量
 *
 * 从 ConversationSidebar 提取的 SOURCE_TYPE_CONFIG / SOURCE_TYPE_ORDER，
 * 供侧边栏、移动端抽屉等多处复用。
 */
import { MessageSquare } from 'lucide-react';
import {
  BaziIcon, DaliurenIcon, FaceIcon, HepanIcon, LiuyaoIcon, MbtiIcon, MeihuaIcon,
  PalmIcon, QimenIcon, TarotIcon, XiaoliurenIcon, ZiweiIcon,
} from '@/lib/navigation/nav-icons';
import type { NavIcon } from '@/lib/navigation/registry';
import type { ConversationSourceType } from '@/types';

// 占术行一律取全站共用的占术图标；普通对话与解梦不是占术，沿用通用的消息图标。
export const SOURCE_TYPE_CONFIG: Record<ConversationSourceType, {
  label: string;
  icon: NavIcon;
  color: string;
}> = {
  chat: { label: '普通对话', icon: MessageSquare, color: 'text-foreground-secondary' },
  bazi_wuxing: { label: '八字五行/人格分析', icon: BaziIcon, color: 'text-foreground-secondary' },
  bazi_personality: { label: '八字五行/人格分析', icon: BaziIcon, color: 'text-foreground-secondary' },
  ziwei: { label: '紫微斗数', icon: ZiweiIcon, color: 'text-foreground-secondary' },
  tarot: { label: '塔罗占卜', icon: TarotIcon, color: 'text-foreground-secondary' },
  liuyao: { label: '六爻占卜', icon: LiuyaoIcon, color: 'text-foreground-secondary' },
  mbti: { label: 'MBTI 分析', icon: MbtiIcon, color: 'text-foreground-secondary' },
  hepan: { label: '合盘分析', icon: HepanIcon, color: 'text-foreground-secondary' },
  palm: { label: '手相分析', icon: PalmIcon, color: 'text-foreground-secondary' },
  face: { label: '面相分析', icon: FaceIcon, color: 'text-foreground-secondary' },
  qimen: { label: '奇门遁甲', icon: QimenIcon, color: 'text-foreground-secondary' },
  daliuren: { label: '大六壬', icon: DaliurenIcon, color: 'text-foreground-secondary' },
  meihua: { label: '梅花易数', icon: MeihuaIcon, color: 'text-foreground-secondary' },
  xiaoliuren: { label: '小六壬', icon: XiaoliurenIcon, color: 'text-foreground-secondary' },
};

/** 显示顺序 — bazi_personality 合并到 bazi_wuxing */
export const SOURCE_TYPE_ORDER: ConversationSourceType[] = [
  'chat', 'bazi_wuxing', 'ziwei', 'tarot', 'liuyao', 'qimen', 'daliuren', 'meihua', 'xiaoliuren', 'mbti', 'hepan', 'palm', 'face',
];
