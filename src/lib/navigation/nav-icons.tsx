/**
 * Single-stroke navigation icons for divination methods and tools.
 *
 * Every glyph is drawn directly on a 24-unit grid at one stroke weight, and its
 * size comes from the keyline of its basic shape rather than from scaling:
 *
 * - circle   — stroke centred on r = 9 (outer edge ≈ 19.6)
 * - square   — 16 × 16 from (4, 4) (outer edge ≈ 17.6)
 * - portrait — 14 × 18 (outer edge ≈ 15.6 × 19.6)
 * - landscape — 20 × 12 (outer edge ≈ 20.4 × 13.6)
 *
 * A square fills its box more than a circle does, and a sparse glyph (dots,
 * rays) needs to reach further than a dense one, so equal keylines — not equal
 * bounding boxes — are what make the set read as one size. Phosphor glyphs
 * (八字 / 紫微) are rendered at their native 256 grid, which follows the same
 * keylines.
 *
 * Hover motion: every icon carries `data-nav-icon` (the composer's inline send arrow too),
 * and the parts that move carry
 * an `ni-*` class. The motions themselves live in `lib/motion/icon-hover.ts`; at
 * rest an icon renders exactly as drawn here.
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
                data-nav-icon={name}
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
        <svg aria-hidden="true" width={size} height={size} viewBox="0 0 256 256" fill="currentColor" className={className} data-nav-icon="agent">
            <path className="ni-glyph" d="M240,149.31c0,16.11-3.17,29.89-9.17,39.84-7.43,12.33-19,18.85-33.39,18.85-27.94,0-47.78-37-68.78-76.22C111.64,100,92.35,64,74,64c-9.38,0-19.94,10-28.25,26.67A138.18,138.18,0,0,0,32,149.31c0,13.2,2.38,24.12,6.88,31.58S49.82,192,58.56,192c15.12,0,30.85-24.54,44.23-48.55a8,8,0,0,1,14,7.8C101.46,178.71,83.07,208,58.56,208c-14.41,0-26-6.52-33.39-18.85-6-10-9.17-23.73-9.17-39.84A154.81,154.81,0,0,1,31.42,83.54C42.82,60.62,57.94,48,74,48c27.94,0,47.77,37,68.78,76.22C159.79,156,179.08,192,197.44,192c8.74,0,15.18-3.63,19.68-11.11S224,162.51,224,149.31a138.18,138.18,0,0,0-13.74-58.64C202,74,191.39,64,182,64c-8.36,0-17.68,7.48-28.51,22.88a8,8,0,1,1-13.08-9.21c9-12.74,23-29.67,41.59-29.67,16.05,0,31.17,12.62,42.57,35.54A154.81,154.81,0,0,1,240,149.31Z" />
        </svg>
    );
}

/**
 * Filled icon on Phosphor's native 256-unit grid (regular weight ≈ 1.5 on the 24
 * grid). `pad` widens the viewBox for glyphs whose points run to the grid edge.
 */
function createFilledIcon(name: string, path: string, pad = 0) {
    const viewBox = `${-pad} ${-pad} ${256 + pad * 2} ${256 + pad * 2}`;
    function Icon({ className, size = 24 }: NavIconProps) {
        return (
            <svg aria-hidden width={size} height={size} viewBox={viewBox} fill="currentColor" className={className} data-nav-icon={name}>
                <path className="ni-glyph" d={path} />
            </svg>
        );
    }
    Icon.displayName = `FilledNavIcon(${name})`;
    return Icon;
}

/** 八字：阴阳鱼（Phosphor YinYang, regular）。 */
export const BaziIcon = createFilledIcon('bazi', 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM40,128a88.1,88.1,0,0,1,88-88,40,40,0,0,1,0,80A56,56,0,0,0,77.39,200,88,88,0,0,1,40,128Zm88,88a40,40,0,0,1,0-80,56,56,0,0,0,50.61-79.95A88,88,0,0,1,128,216Zm12-40a12,12,0,1,1-12-12A12,12,0,0,1,140,176ZM116,80a12,12,0,1,1,12,12A12,12,0,0,1,116,80Z');

/** 紫微斗数：罗盘星（Phosphor CompassRose, regular）；四芒顶到格边，留 10 单位边距。 */
export const ZiweiIcon = createFilledIcon('ziwei', 'M249.94,120.24l-27.05-6.76a95.86,95.86,0,0,0-80.37-80.37l-6.76-27a8,8,0,0,0-15.52,0l-6.76,27.05a95.86,95.86,0,0,0-80.37,80.37l-27,6.76a8,8,0,0,0,0,15.52l27.05,6.76a95.86,95.86,0,0,0,80.37,80.37l6.76,27.05a8,8,0,0,0,15.52,0l6.76-27.05a95.86,95.86,0,0,0,80.37-80.37l27.05-6.76a8,8,0,0,0,0-15.52Zm-95.49,22.9L139.31,128l15.14-15.14L215,128Zm-52.9,0L41,128l60.57-15.14L116.69,128ZM205.77,109.2,158.6,97.4,146.8,50.23A79.88,79.88,0,0,1,205.77,109.2Zm-62.63-7.65L128,116.69l-15.14-15.14L128,41ZM109.2,50.23,97.4,97.4,50.23,109.2A79.88,79.88,0,0,1,109.2,50.23Zm-59,96.57L97.4,158.6l11.8,47.17A79.88,79.88,0,0,1,50.23,146.8Zm62.63,7.65L128,139.31l15.14,15.14L128,215Zm33.94,51.32,11.8-47.17,47.17-11.8A79.88,79.88,0,0,1,146.8,205.77Z', 10);

/** 塔罗：一张牌，牌面一颗四芒星（竖向关键线）。 */
export const TarotIcon = createNavIcon('tarot', <g className="ni-card">
    <rect x="5.5" y="3" width="13" height="18" rx="2.2" />
    <path className="ni-star" d="M12 7.8l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" />
</g>);

/** 八字合盘：两盘相交，交集涂实即为「合」（横向关键线）。 */
export const HepanIcon = createNavIcon('hepan', <>
    <circle className="ni-left" cx="8.6" cy="12" r="6" />
    <circle className="ni-right" cx="15.4" cy="12" r="6" />
    <path className="ni-lens" d="M12 7.06a6 6 0 0 1 0 9.88 6 6 0 0 1 0-9.88z" fill="currentColor" stroke="none" />
</>);

/** 六爻：地山谦䷎（上坤下艮，唯九三为阳），自上而下画六爻，阴爻中断；横线密，比方形关键线收窄一格。 */
const QIAN_LINES = [
    'M5 4h5.4M13.6 4H19',
    'M5 7.2h5.4M13.6 7.2H19',
    'M5 10.4h5.4M13.6 10.4H19',
    'M5 13.6h14',
    'M5 16.8h5.4M13.6 16.8H19',
    'M5 20h5.4M13.6 20H19',
];

export const LiuyaoIcon = createNavIcon('liuyao', <>
    {QIAN_LINES.map(d => <path key={d} className="ni-yao" d={d} />)}
</>);

/** 奇门遁甲：九宫格，中五宫涂实（方形关键线）。 */
export const QimenIcon = createNavIcon('qimen', <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16" />
    <rect className="ni-palace" x="9.33" y="9.33" width="5.34" height="5.34" fill="currentColor" stroke="none" />
</>);

/**
 * 大六壬：盘中两道水纹——六壬以壬水得名（天一生水，六十甲子中有六个壬）（圆形关键线）。
 * 每道水纹画了三个波长，虚线只露出右边两个（pathLength 归一到 300，一个波长 = 100）：
 * 悬停时整条右移一个波长、虚线同步退回，波峰流过而两端不动；静止时与只画两个波长一样。
 */
const WAVE = 'q1.35-1.3 2.7 0t2.7 0 2.7 0 2.7 0 2.7 0 2.7 0';

export const DaliurenIcon = createNavIcon('daliuren', <>
    <circle cx="12" cy="12" r="9" />
    <path className="ni-wave" d={`M1.2 10.2${WAVE}`} pathLength={300} strokeDasharray="200 400" strokeDashoffset={-100} />
    <path className="ni-wave" d={`M1.2 14.2${WAVE}`} pathLength={300} strokeDasharray="200 400" strokeDashoffset={-100} />
</>);

/** 梅花易数：五片倒卵形花瓣（近心收窄、外端圆宽，梅瓣的特征）+ 花心一点。 */
const MEIHUA_PETAL = 'M12 10.50C10.43 9.50 9.15 6.28 9.15 5.85A2.85 2.85 0 0 1 14.85 5.85C14.85 6.28 13.57 9.50 12 10.50z';

export const MeihuaIcon = createNavIcon('meihua', <>
    {[0, 72, 144, 216, 288].map(angle => (
        <g key={angle} transform={`rotate(${angle} 12 12.4)`}>
            <path className="ni-petal" d={MEIHUA_PETAL} />
        </g>
    ))}
    <circle className="ni-core" cx="12" cy="12.4" r="1.1" fill="currentColor" stroke="none" />
</>);

/**
 * 小六壬：大安、留连、速喜、赤口、小吉、空亡六宫成环（圆形关键线）。
 * 落宫是叠在大安上的一枚实心点，悬停时它顺时针一宫一跳，转一圈回到大安。
 */
const XIAOLIUREN_PALACES = [[12, 4.8], [18.24, 8.4], [18.24, 15.6], [12, 19.2], [5.76, 15.6], [5.76, 8.4]] as const;

export const XiaoliurenIcon = createNavIcon('xiaoliuren', <>
    {XIAOLIUREN_PALACES.map(([cx, cy]) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r="1.9" />)}
    <g className="ni-count">
        <circle className="ni-cursor" cx="12" cy="4.8" r="1.9" fill="currentColor" />
    </g>
</>);

/** 面相：鹅蛋脸——额宽颊满、下巴收圆（竖向关键线）+ 双眼与笑纹。 */
export const FaceIcon = createNavIcon('face', <g className="ni-face">
    <path d="M12 2.7C16.9 2.7 20.2 6.2 20.2 11C20.2 16.6 16.6 21.3 12 21.3C7.4 21.3 3.8 16.6 3.8 11C3.8 6.2 7.1 2.7 12 2.7z" />
    <path className="ni-eye" d="M9.2 10.6h.01" />
    <path className="ni-eye" d="M14.8 10.6h.01" />
    <path d="M9.2 15.1q2.8 2 5.6 0" />
</g>);

/**
 * 手相轮廓：四指 + 拇指，四指高度递进、拇指从掌根斜出，已居中到 24 格。
 * 导出是为了让上传页那张虚线手掌插画与图标共用同一份形状
 * （插画只是同一组路径放大描虚线，改这里两边一起变）。
 */
export const PALM_GLYPH_PATHS: readonly string[] = Object.freeze([
    'M7.5 13.8V6.7a1.6 1.6 0 0 1 3.2 0v4',
    'M10.7 10.7V4.7a1.6 1.6 0 0 1 3.2 0v6',
    'M13.9 10.7V5.7a1.6 1.6 0 0 1 3.2 0v5',
    'M17.1 10.7V8.3a1.6 1.6 0 0 1 3.2 0',
    'M20.3 8.3v6a6.6 6.6 0 0 1-6.6 6.6h-1.4a6.6 6.6 0 0 1-5.1-2.4L4.1 14.7a1.6 1.6 0 0 1 2.5-2l.9 1.1',
]);

export const PalmIcon = createNavIcon('palm', <g className="ni-palm">
    {PALM_GLYPH_PATHS.map(d => <path key={d} d={d} />)}
</g>);

/** MBTI：四象限（方形关键线）。四块填色平时透明，悬停时顺时针逐块亮一下，扫过四个维度。 */
const MBTI_QUADRANTS = [
    'M12 4H7a3 3 0 0 0-3 3v5h8z',
    'M12 4h5a3 3 0 0 1 3 3v5h-8z',
    'M12 20h5a3 3 0 0 0 3-3v-5h-8z',
    'M12 20H7a3 3 0 0 1-3-3v-5h8z',
];

export const MbtiIcon = createNavIcon('mbti', <>
    {MBTI_QUADRANTS.map(d => <path key={d} className="ni-quad" d={d} fill="currentColor" stroke="none" opacity={0} />)}
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 4v16M4 12h16" />
</>);

/** 日运：日出——地平线、半轮与三道芒，下方一道短线压住重心。 */
export const DailyIcon = createNavIcon('daily', <>
    <path d="M3 15.75h18M8 19.25h8" />
    <path className="ni-sun" d="M7 15.75a5 5 0 0 1 10 0" />
    <path className="ni-ray" d="M6.4 9.65 4.8 8.05" />
    <path className="ni-ray" d="M12 7.25v-2.5" />
    <path className="ni-ray" d="M17.6 9.65l1.6-1.6" />
</>);

/** 月运：残月，缺口处一颗星，与日运的日出成对。 */
export const MonthlyIcon = createNavIcon('monthly', <>
    <path className="ni-moon" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    <path className="ni-star" d="M17.4 4.2v3.2M15.8 5.8H19" />
</>);

/** 太乙：九宫阵列（中宫 + 八向点），与奇门/小六壬同一套点线语言。 */
export const TaiyiIcon = createNavIcon('taiyi', <>
    <circle className="ni-ring-0" cx="12" cy="12" r="1.6" />
    <circle className="ni-ring-1" cx="12" cy="5" r="1.2" />
    <circle className="ni-ring-1" cx="12" cy="19" r="1.2" />
    <circle className="ni-ring-1" cx="5" cy="12" r="1.2" />
    <circle className="ni-ring-1" cx="19" cy="12" r="1.2" />
    <circle className="ni-ring-2" cx="7" cy="7" r="1.2" />
    <circle className="ni-ring-2" cx="17" cy="7" r="1.2" />
    <circle className="ni-ring-2" cx="7" cy="17" r="1.2" />
    <circle className="ni-ring-2" cx="17" cy="17" r="1.2" />
</>);

/** 占星：黄道环 + 内接三角，表达星盘宫位。 */
export const AstrologyIcon = createNavIcon('astrology', <>
    <circle cx="12" cy="12" r="8.5" />
    <path className="ni-cross" d="M12 3.5v17M3.5 12h17" />
    <circle cx="12" cy="12" r="3.4" />
</>);

/** 命理记录：一叠页，悬停时像翻页一样掀一下（整册绕左下角转）。 */
export const RecordsIcon = createNavIcon('records', <g className="ni-glyph">
    <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" />
    <path d="M8 9h8M8 13h6" />
</g>);

/** 社区：主位点一下头，旁边那位凑近一点。 */
export const CommunityIcon = createNavIcon('community', <>
    <g className="ni-person">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20a6 6 0 0 1 12 0" />
    </g>
    <path className="ni-peer" d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6" />
</>);

// ── Shell / settings icons ────────────────────────────────────────────────
// 与占术图标同一套单线语言（24 网格、1.6 圆头），全站导航与设置中心统一取自这里。

/** 新聊天：气泡一弹、往上浮一下。 */
export const ChatIcon = createNavIcon('chat', <path className="ni-bubble" d="M12 4c4.7 0 8.5 3 8.5 6.8S16.7 17.6 12 17.6c-1 0-2-.1-2.9-.4L5 19l1.3-3.3A6.3 6.3 0 0 1 3.5 10.8C3.5 7 7.3 4 12 4z" />);

/** 我的：头轻轻点一下。 */
export const ProfileIcon = createNavIcon('profile', <>
    <circle className="ni-head" cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
</>);

/** 设置：六齿齿轮——悬停时转过一格（60°，齿对齿，停在原位）。 */
export const SettingsIcon = createNavIcon('settings', <g className="ni-glyph">
    <path d="M10.4 3.6h3.2l.5 2.3 1.6.9 2.2-.7 1.6 2.8-1.7 1.6v1.9l1.7 1.6-1.6 2.8-2.2-.7-1.6.9-.5 2.3h-3.2l-.5-2.3-1.6-.9-2.2.7-1.6-2.8 1.7-1.6v-1.9L4.5 8.9l1.6-2.8 2.2.7 1.6-.9z" />
    <circle cx="12" cy="12" r="2.8" />
</g>);

/** 订阅：五角星闪一下（转 72° 仍是同一颗星）。 */
export const UpgradeIcon = createNavIcon('upgrade', <>
    <circle cx="12" cy="12" r="8.5" />
    <path className="ni-star" d="M12 8.1l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" />
</>);

/** 命盘：一叠盘，悬停时像翻卡片一样掀一下。 */
export const ChartsIcon = createNavIcon('charts', <g className="ni-glyph">
    <path d="M6 4.5h9.5a2.5 2.5 0 0 1 2.5 2.5v9.5a2.5 2.5 0 0 0 2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5z" />
    <path d="M11 8.6h4M11 12.4h4" />
</g>);

/** 通知：铃身以顶上挂点为中心摇两下，铃舌慢半拍跟着摆。 */
export const BellIcon = createNavIcon('bell', <>
    <path className="ni-bell" d="M12 4.5c-2.8 0-5 2.2-5 5v3.5L5.6 16h12.8L17 13V9.5c0-2.8-2.2-5-5-5z" />
    <path className="ni-clapper" d="M10 19a2 2 0 0 0 4 0" />
</>);

/** 个性化：与侧栏 Agent 入口同一枚 ∞ 标记。 */
export const PersonalizationIcon = AgentIcon;

/** 知识库：摊开的书，悬停时两页从书脊向外翻一下。 */
export const KnowledgeIcon = createNavIcon('knowledge', <>
    <path className="ni-page-left" d="M12 6.6C10.2 5.2 8.3 4.6 6 4.6v12c2.3 0 4.2.6 6 2z" />
    <path className="ni-page-right" d="M12 6.6C13.8 5.2 15.7 4.6 18 4.6v12c-2.3 0-4.2.6-6 2z" />
</>);

/** 帮助：问号歪一下头，像在琢磨。 */
export const HelpIcon = createNavIcon('help', <g className="ni-glyph">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.7 9.6a2.4 2.4 0 0 1 4.7.6c0 1.5-2.3 1.7-2.3 3" />
    <path d="M12.1 16.6h.01" />
</g>);

/** 密钥（BYOK）：钥匙绕锁孔转一下。 */
export const KeyIcon = createNavIcon('key', <g className="ni-key">
    <circle cx="8" cy="12" r="3.6" />
    <path d="M11.6 12H20M17 12v2.6M14.2 12v1.8" />
</g>);

/** 分享链接：两环向中间靠一下、再拉开，像扣上又松开。 */
export const ShareLinkIcon = createNavIcon('share-link', <>
    <path className="ni-link-a" d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" />
    <path className="ni-link-b" d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
</>);

/** 公告：喇叭扬起，声波向外一荡。 */
export const MegaphoneIcon = createNavIcon('megaphone', <>
    <g className="ni-horn">
        <path d="M4.5 10.5l10-4.5v12l-10-4.5z" />
        <path d="M7 14.2l1.2 4.3a1.6 1.6 0 0 0 2 .8l.6-.2" />
    </g>
    <path className="ni-sound" d="M14.5 8.5H19a1.5 1.5 0 0 1 0 7h-1.2" />
</>);

/** 功能开关：开关条往右拨一下。 */
export const FeatureFlagsIcon = createNavIcon('feature-flags', <>
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <path d="M4 10h16" />
    <circle className="ni-dot" cx="8.2" cy="7.5" r=".6" fill="currentColor" stroke="none" />
    <path className="ni-switch" d="M7.5 15.5h9" />
</>);

/** AI 服务：机器人眨一下眼，天线亮一下。 */
export const BotIcon = createNavIcon('bot', <>
    <rect x="5" y="8" width="14" height="10" rx="3" />
    <path className="ni-antenna" d="M12 5v3" />
    <circle className="ni-eye" cx="9.2" cy="12.8" r=".6" fill="currentColor" stroke="none" />
    <circle className="ni-eye" cx="14.8" cy="12.8" r=".6" fill="currentColor" stroke="none" />
</>);

export const PlugIcon = createNavIcon('plug', <>
    <path d="M9 4v4M15 4v4" />
    <path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z" />
    <path d="M12 16.5V20" />
</>);

export const PuzzleIcon = createNavIcon('puzzle', <path d="M5.5 8.5h3.4a2 2 0 1 1 4 0h3.6v3.4a2 2 0 1 1 0 4v3.6h-11z" />);

/** MCP：一笔涂鸦，悬停时像刚写上去一样顺着笔迹画出来。 */
export const ScribbleIcon = createNavIcon('scribble', <g className="ni-glyph">
    <path pathLength={100} d="M5 14.5c1-4 2.6-6 4-6s1.6 2 .8 4.4c-.7 2.2-.3 3.4 1 3.4 1.8 0 3.2-2.6 4.4-5.6" />
    <path d="M15.2 10.2c.9-.6 1.9-.7 2.6-.2" />
</g>);

// ── Shell actions ─────────────────────────────────────────────────────────
// 侧栏搜索 / 新建 / 全部占术 / 登录与占术图标同一套单线语言（不再混用 lucide）。

/** 搜索：镜片圆不动，手柄扫一下，像探头找东西。 */
export const SearchIcon = createNavIcon('search', <g className="ni-glyph">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.2 4.2" />
</g>);

/** 新建：十字转四分之一圈（四向对称，停在原位）。 */
export const PlusIcon = createNavIcon('plus', <g className="ni-glyph"><path d="M12 5.5v13M5.5 12h13" /></g>, 1.8);

/** 全部占术：四宫逐格亮一下。 */
export const AllDivinationsIcon = createNavIcon('all-divinations', <>
    <rect className="ni-cell" x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect className="ni-cell" x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect className="ni-cell" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect className="ni-cell" x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
</>);

export const LoginIcon = createNavIcon('login', <>
    <path d="M13.5 5H7.5A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19h6" />
    <g className="ni-arrow"><path d="M12 12h8M17 8.8l3.2 3.2-3.2 3.2" /></g>
</>);
