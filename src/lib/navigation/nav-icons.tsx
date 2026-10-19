/**
 * Single-stroke navigation icons for divination methods and tools.
 *
 * They follow the design boards: 24px grid, 1.6 stroke, round caps, currentColor,
 * so they sit at the same visual weight as the surrounding sidebar text.
 */
import type { ReactNode } from 'react';

type NavIconProps = { className?: string; size?: number | string };

function createNavIcon(name: string, body: ReactNode, strokeWidth = 1.6) {
    function Icon({ className, size = 24 }: NavIconProps) {
        return (
            <svg
                aria-hidden
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={className}
            >
                {body}
            </svg>
        );
    }
    Icon.displayName = `NavIcon(${name})`;
    return Icon;
}

/**
 * Agent 模式图标：与「个性化」设置同一枚 Meta 标记（∞ 形双环），
 * 路径取自 Phosphor MetaLogo 的 regular 字重（256 网格）。
 * 内联 SVG，避免在纯 Node 测试里引入 phosphor 的 CJS 入口。
 */
export function AgentIcon({ className, size = 24 }: NavIconProps) {
    return (
        <svg aria-hidden="true" width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className}>
            <path d="M240,149.31c0,16.11-3.17,29.89-9.17,39.84-7.43,12.33-19,18.85-33.39,18.85-27.94,0-47.78-37-68.78-76.22C111.64,100,92.35,64,74,64c-9.38,0-19.94,10-28.25,26.67A138.18,138.18,0,0,0,32,149.31c0,13.2,2.38,24.12,6.88,31.58S49.82,192,58.56,192c15.12,0,30.85-24.54,44.23-48.55a8,8,0,0,1,14,7.8C101.46,178.71,83.07,208,58.56,208c-14.41,0-26-6.52-33.39-18.85-6-10-9.17-23.73-9.17-39.84A154.81,154.81,0,0,1,31.42,83.54C42.82,60.62,57.94,48,74,48c27.94,0,47.77,37,68.78,76.22C159.79,156,179.08,192,197.44,192c8.74,0,15.18-3.63,19.68-11.11S224,162.51,224,149.31a138.18,138.18,0,0,0-13.74-58.64C202,74,191.39,64,182,64c-8.36,0-17.68,7.48-28.51,22.88a8,8,0,1,1-13.08-9.21c9-12.74,23-29.67,41.59-29.67,16.05,0,31.17,12.62,42.57,35.54A154.81,154.81,0,0,1,240,149.31Z" />
        </svg>
    );
}

export const BaziIcon = createNavIcon('bazi', <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0 9" />
</>);

export const HepanIcon = createNavIcon('hepan', <>
    <circle cx="9" cy="12" r="6" />
    <circle cx="15" cy="12" r="6" />
</>);

export const ZiweiIcon = createNavIcon('ziwei', <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z" />);

export const TarotIcon = createNavIcon('tarot', <>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <circle cx="12" cy="12" r="3" />
</>);

export const LiuyaoIcon = createNavIcon('liuyao', <path d="M5 5h14M5 9.7h5M14 9.7h5M5 14.3h14M5 19h5M14 19h5" />, 1.8);

export const QimenIcon = createNavIcon('qimen', <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" />
</>);

export const DaliurenIcon = createNavIcon('daliuren', <>
    <circle cx="12" cy="12" r="9" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
</>);

export const MeihuaIcon = createNavIcon('meihua', <>
    <circle cx="12" cy="6.8" r="2.7" />
    <circle cx="6.9" cy="10.6" r="2.7" />
    <circle cx="17.1" cy="10.6" r="2.7" />
    <circle cx="8.9" cy="16.7" r="2.7" />
    <circle cx="15.1" cy="16.7" r="2.7" />
</>);

export const XiaoliurenIcon = createNavIcon('xiaoliuren', <>
    <circle cx="6" cy="18" r="2" />
    <circle cx="12" cy="7" r="2" />
    <circle cx="18" cy="16" r="2" />
    <path d="M7.2 16.4l3.6-7.6M13.6 8.4l3.4 6" />
</>);

export const FaceIcon = createNavIcon('face', <>
    <ellipse cx="12" cy="12" rx="7" ry="9" />
    <path d="M9.5 10.5h.01M14.5 10.5h.01M9.5 15.5q2.5 1.8 5 0" />
</>);

export const PalmIcon = createNavIcon('palm', <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V5.5a1.5 1.5 0 0 1 3 0V13M8 13l-1.6-2a1.5 1.5 0 0 0-2.4 1.8L7 17a6 6 0 0 0 5 3h1a5 5 0 0 0 5-5v-2" />);

export const MbtiIcon = createNavIcon('mbti', <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 4v16M4 12h16" />
</>);

export const DailyIcon = createNavIcon('daily', <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
</>);

export const MonthlyIcon = createNavIcon('monthly', <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);

/** 太乙：九宫阵列（中宫 + 八向点），与奇门/小六壬同一套点线语言。 */
export const TaiyiIcon = createNavIcon('taiyi', <>
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="5" r="1.2" />
    <circle cx="12" cy="19" r="1.2" />
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
    <circle cx="7" cy="7" r="1.2" />
    <circle cx="17" cy="7" r="1.2" />
    <circle cx="7" cy="17" r="1.2" />
    <circle cx="17" cy="17" r="1.2" />
</>);

/** 占星：黄道环 + 内接三角，表达星盘宫位。 */
export const AstrologyIcon = createNavIcon('astrology', <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17M3.5 12h17" />
    <circle cx="12" cy="12" r="3.4" />
</>);

export const RecordsIcon = createNavIcon('records', <>
    <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" />
    <path d="M8 9h8M8 13h6" />
</>);

export const CommunityIcon = createNavIcon('community', <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6" />
</>);

// ── Shell / settings icons ────────────────────────────────────────────────
// 与占术图标同一套单线语言（24 网格、1.6 圆头），全站导航与设置中心统一取自这里。

export const ChatIcon = createNavIcon('chat', <>
    <path d="M12 4c4.7 0 8.5 3 8.5 6.8S16.7 17.6 12 17.6c-1 0-2-.1-2.9-.4L5 19l1.3-3.3A6.3 6.3 0 0 1 3.5 10.8C3.5 7 7.3 4 12 4z" />
</>);

export const ProfileIcon = createNavIcon('profile', <>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
</>);

export const SettingsIcon = createNavIcon('settings', <>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
</>);

export const UpgradeIcon = createNavIcon('upgrade', <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8.1l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" />
</>);

export const ChartsIcon = createNavIcon('charts', <>
    <path d="M6 4.5h9.5a2.5 2.5 0 0 1 2.5 2.5v9.5a2.5 2.5 0 0 0 2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5z" />
    <path d="M11 8.6h4M11 12.4h4" />
</>);

export const BellIcon = createNavIcon('bell', <>
    <path d="M12 4.5c-2.8 0-5 2.2-5 5v3.5L5.6 16h12.8L17 13V9.5c0-2.8-2.2-5-5-5z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
</>);

/** 个性化：与侧栏 Agent 入口同一枚 ∞ 标记。 */
export const PersonalizationIcon = AgentIcon;

export const KnowledgeIcon = createNavIcon('knowledge', <>
    <path d="M12 6.6C10.2 5.2 8.3 4.6 6 4.6v12c2.3 0 4.2.6 6 2 1.8-1.4 3.7-2 6-2v-12c-2.3 0-4.2.6-6 2z" />
    <path d="M12 6.6v12" />
</>);

export const HelpIcon = createNavIcon('help', <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.7 9.6a2.4 2.4 0 0 1 4.7.6c0 1.5-2.3 1.7-2.3 3" />
    <path d="M12.1 16.6h.01" />
</>);

export const KeyIcon = createNavIcon('key', <>
    <circle cx="8" cy="12" r="3.6" />
    <path d="M11.6 12H20M17 12v2.6M14.2 12v1.8" />
</>);

export const ShareLinkIcon = createNavIcon('share-link', <>
    <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" />
    <path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
</>);

export const MegaphoneIcon = createNavIcon('megaphone', <>
    <path d="M4.5 10.5l10-4.5v12l-10-4.5z" />
    <path d="M14.5 8.5H19a1.5 1.5 0 0 1 0 7h-1.2M7 14.2l1.2 4.3a1.6 1.6 0 0 0 2 .8l.6-.2" />
</>);

export const FeatureFlagsIcon = createNavIcon('feature-flags', <>
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <path d="M4 10h16" />
    <circle cx="8.2" cy="7.5" r=".6" fill="currentColor" stroke="none" />
    <path d="M7.5 15.5h9" />
</>);

export const BotIcon = createNavIcon('bot', <>
    <rect x="5" y="8" width="14" height="10" rx="3" />
    <path d="M12 5v3" />
    <circle cx="9.2" cy="12.8" r=".6" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="12.8" r=".6" fill="currentColor" stroke="none" />
</>);

export const ScribbleIcon = createNavIcon('scribble', <>
    <path d="M5 14.5c1-4 2.6-6 4-6s1.6 2 .8 4.4c-.7 2.2-.3 3.4 1 3.4 1.8 0 3.2-2.6 4.4-5.6" />
    <path d="M15.2 10.2c.9-.6 1.9-.7 2.6-.2" />
</>);

// ── Shell actions ─────────────────────────────────────────────────────────
// 侧栏搜索 / 新建 / 全部占术 / 登录与占术图标同一套单线语言（不再混用 lucide）。

export const SearchIcon = createNavIcon('search', <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.2 4.2" />
</>);

export const PlusIcon = createNavIcon('plus', <path d="M12 5.5v13M5.5 12h13" />, 1.8);

export const AllDivinationsIcon = createNavIcon('all-divinations', <>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
</>);

export const LoginIcon = createNavIcon('login', <>
    <path d="M13.5 5H7.5A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19h6" />
    <path d="M12 12h8M17 8.8l3.2 3.2-3.2 3.2" />
</>);
