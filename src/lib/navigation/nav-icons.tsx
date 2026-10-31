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

/** 20 网格的图标换到本套 24 网格；`boost` 再整体放大，线宽一起回调。 */
const GRID20_SCALE = 16 / 15;

function grid20Glyph(body: ReactNode, boost = 1) {
    const scale = GRID20_SCALE * boost;
    return (
        <g transform={`translate(12 12) scale(${scale.toFixed(4)}) translate(-10 -10)`} strokeWidth={(1.6 / scale).toFixed(3)}>
            {body}
        </g>
    );
}

/** 24 网格的图形绕中心放大，线宽一起回调，放大后仍是同一套笔画粗细。 */
function enlarged(body: ReactNode, scale: number) {
    return (
        <g transform={`translate(12 12) scale(${scale}) translate(-12 -12)`} strokeWidth={(1.6 / scale).toFixed(3)}>
            {body}
        </g>
    );
}

/** 新聊天：气泡一弹、往上浮一下。 */
export const ChatIcon = createNavIcon('chat', <path className="ni-bubble" d="M12 4c4.7 0 8.5 3 8.5 6.8S16.7 17.6 12 17.6c-1 0-2-.1-2.9-.4L5 19l1.3-3.3A6.3 6.3 0 0 1 3.5 10.8C3.5 7 7.3 4 12 4z" />);

/** 我的 / 账户：圈中人像（圆形关键线）——和齿轮、帮助、救生圈同一个大小。 */
export const ProfileIcon = createNavIcon('profile', <>
    <circle cx="12" cy="12" r="9" />
    <circle className="ni-head" cx="12" cy="9.8" r="3.2" />
    <path d="M6.34 19c1.2-2.4 3.26-3.7 5.66-3.7s4.46 1.3 5.66 3.7" />
</>);

/**
 * 设置：八齿齿轮。齿顶、齿根各用一段圆弧相连，轮廓近似一个整圆（圆形关键线 r=9），
 * 比六齿的轮廓更「圆」。悬停时转过一格 45°，齿对齿，停在原位。
 */
const GEAR_OUTLINE =
    'M10.16 5.35L10.67 3.1A9 9 0 0 1 13.33 3.1L13.84 5.35A6.9 6.9 0 0 1 15.4 5.99L17.35 4.77A9 9 0 0 1 19.23 6.65L18.01 8.6A6.9 6.9 0 0 1 18.65 10.16L20.9 10.67A9 9 0 0 1 20.9 13.33L18.65 13.84A6.9 6.9 0 0 1 18.01 15.4L19.23 17.35A9 9 0 0 1 17.35 19.23L15.4 18.01A6.9 6.9 0 0 1 13.84 18.65L13.33 20.9A9 9 0 0 1 10.67 20.9L10.16 18.65A6.9 6.9 0 0 1 8.6 18.01L6.65 19.23A9 9 0 0 1 4.77 17.35L5.99 15.4A6.9 6.9 0 0 1 5.35 13.84L3.1 13.33A9 9 0 0 1 3.1 10.67L5.35 10.16A6.9 6.9 0 0 1 5.99 8.6L4.77 6.65A9 9 0 0 1 6.65 4.77L8.6 5.99A6.9 6.9 0 0 1 10.16 5.35Z';

export const SettingsIcon = createNavIcon('settings', <g className="ni-glyph">
    <path d={GEAR_OUTLINE} />
    <circle cx="12" cy="12" r="2.8" />
</g>);

/** 订阅与余额：一张卡（横向关键线）——订阅额度和余额都落在这一张上；悬停时像抽出卡槽再插回。 */
export const BillingIcon = createNavIcon('billing', <g className="ni-card">
    <rect x="2.6" y="5" width="18.8" height="14" rx="2.2" />
    <path d="M2.6 9.2h18.8" />
    <path d="M6 15.2h4.2" />
</g>);

/**
 * 命盘：紫微命盘的十二宫格局——外圈十二格、中间留空。
 * 悬停时中宫亮一下，像落了一颗星（四化归中）。
 */
export const ChartsIcon = createNavIcon('charts', enlarged(<>
    <rect x="4" y="4" width="16" height="16" rx="1.6" />
    <path d="M8 4v16M16 4v16M4 8h16M4 16h16" />
    <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
    <rect className="ni-palace" x="8" y="8" width="8" height="8" fill="currentColor" stroke="none" opacity={0} />
</>, 1.125));

/** 通知：铃身以顶上挂点为中心摇两下，铃舌慢半拍跟着摆。 */
export const BellIcon = createNavIcon('bell', <>
    <path className="ni-bell" d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33" />
    <path className="ni-clapper" d="M10.27 20a2 2 0 0 0 3.46 0" />
</>);

/** 定时任务：表盘与指针，和会话列表里的时钟标记同一形状；悬停时指针走一圈。 */
export const ScheduleIcon = createNavIcon('schedule', <>
    <circle cx="12" cy="12" r="8.5" />
    <path className="ni-hand" d="M12 7.5V12l3 1.8" />
</>);

/**
 * 个性化：一支斜着的毛笔，下面一道墨痕——「文风与偏好」本义。
 * （Agent 入口那枚 ∞ 仍归 AgentIcon，两者不再共用。）
 */
export const PersonalizationIcon = createNavIcon('personalization', enlarged(<>
    <g className="ni-brush">
        <g transform="rotate(45 12 12)">
            <path d="M12 2.4v8.2" />
            <path d="M9.6 10.9h4.8c0 4-.8 7.5-2.4 10.6-1.6-3.1-2.4-6.6-2.4-10.6z" />
        </g>
    </g>
    <path className="ni-ink" pathLength={100} d="M12.6 20.4q1.6-1.6 3.2 0t3.2 0" />
</>, 1.1));

/** 记忆：回环箭头 + 波浪 + 左上回勾。 */
export const MemoryIcon = createNavIcon('memory', grid20Glyph(<g className="ni-glyph">
    <path d="M3 10C3 13.866 6.134 17 10 17C13.866 17 17 13.866 17 10C17 6.134 13.866 3 10 3C7.409 3 5.147 4.408 3.936 6.5" />
    <path className="ni-memory-wave" d="M6.25 10.75C6.876 10.75 7.428 10.253 7.75 9.5C8.072 10.253 8.624 10.75 9.25 10.75C9.876 10.75 10.428 10.253 10.75 9.5C11.072 10.253 11.624 10.75 12.25 10.75C12.876 10.75 13.428 10.253 13.75 9.5" />
    <path d="M3.5 3.5L3.5 6.5L6.5 6.5" />
</g>, 1.2));

/** 知识库：摊开的书，悬停时两页从书脊向外翻一下。 */
export const KnowledgeIcon = createNavIcon('knowledge', grid20Glyph(<>
    <path className="ni-page-left" d="M3 4.5L7 4.5C8.657 4.5 10 5.843 10 7.5L10 17C9.701 16.104 8.863 15.5 7.919 15.5L3 15.5C2.724 15.5 2.5 15.276 2.5 15L2.5 5C2.5 4.724 2.724 4.5 3 4.5Z" />
    <path className="ni-page-right" d="M17 4.5L13 4.5C11.343 4.5 10 5.843 10 7.5L10 17C10.299 16.104 11.137 15.5 12.081 15.5L17 15.5C17.276 15.5 17.5 15.276 17.5 15L17.5 5C17.5 4.724 17.276 4.5 17 4.5Z" />
</>, 1.13));

/** 帮助：救生圈——外圈、内圈与四道辐条；悬停时转过一格（辐条每 90° 一圈）。 */
export const HelpIcon = createNavIcon('help', <g className="ni-glyph">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.8" />
    <path d="M5.64 5.64 9.31 9.31M14.69 9.31l3.67-3.67M14.69 14.69l3.67 3.67M9.31 14.69l-3.67 3.67" />
</g>);

/** 自定义模型（BYOK）：一把斜放的钥匙，齿朝下；悬停时绕中心一拧。 */
export const KeyIcon = createNavIcon('key', <g className="ni-glyph">
    <g transform="rotate(45 12 12)">
        <circle cx="12" cy="6.2" r="4.4" />
        <circle cx="12" cy="5" r="1.1" />
        <path d="M12 10.6v10.9" />
        <path d="M12 17.4h2.5M12 20.2h2.5" />
    </g>
</g>);

/** 分享链接：两环向中间靠一下、再拉开，像扣上又松开。 */
export const ShareLinkIcon = createNavIcon('share-link', enlarged(<>
    <path className="ni-link-a" d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" />
    <path className="ni-link-b" d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
</>, 1.26));

/** 公告：喇叭——喇叭口是一段椭圆弧，带握把和一道声波；悬停时扬起、声波一荡。 */
export const MegaphoneIcon = createNavIcon('megaphone', enlarged(<>
    <g className="ni-horn">
        <path d="M5.2 10.2 14.6 5.6v12.8L5.2 13.8a1.8 1.8 0 0 1 0-3.6z" />
        <path d="M14.6 5.6c1.1 0 2 2.9 2 6.4s-.9 6.4-2 6.4" />
        <path d="M7.6 14.6l1.1 3.8h2.3l-.9-3" />
    </g>
    <path className="ni-sound" d="M19.6 9.5a3.4 3.4 0 0 1 0 5" />
</>, 1.1));

/** 功能开关：一张票券（两侧月牙口、虚线撕口）；悬停时歪一下。 */
export const FeatureFlagsIcon = createNavIcon('feature-flags', enlarged(<g className="ni-glyph">
    <path d="M3 8a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 8v1.6a2.4 2.4 0 0 0 0 4.8V16a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16v-1.6a2.4 2.4 0 0 0 0-4.8z" />
    <path d="M15 9v.6M15 11.7v.6M15 14.4v.6" />
</g>, 1.12));

/** AI 服务：两台叠放的机器（网关与模型），各有一枚指示灯；悬停时灯先后亮一下。 */
export const ServerIcon = createNavIcon('server', enlarged(<>
    <rect x="4" y="4.5" width="16" height="6.5" rx="2" />
    <rect x="4" y="13" width="16" height="6.5" rx="2" />
    <circle className="ni-led" cx="7.6" cy="7.75" r=".7" fill="currentColor" stroke="none" />
    <circle className="ni-led" cx="7.6" cy="16.25" r=".7" fill="currentColor" stroke="none" />
</>, 1.125));

/** 连接器：三块已经接上、一块待接入；悬停时待接那块卡进来。 */
export const ConnectorsIcon = createNavIcon('connectors', grid20Glyph(<>
    <path d="M13.5 15.75L13.5 12.25C13.5 11.836 13.164 11.5 12.75 11.5L8.5 11.5L8.5 7.25C8.5 6.836 8.164 6.5 7.75 6.5L4.25 6.5C3.836 6.5 3.5 6.836 3.5 7.25L3.5 11.5L3.5 15.75C3.5 16.164 3.836 16.5 4.25 16.5L8.5 16.5L12.75 16.5C13.164 16.5 13.5 16.164 13.5 15.75ZM8.5 11.5L3.5 11.5M8.5 11.5L8.5 16.5" />
    <path className="ni-plug" d="M11.5 4.25L11.5 7.75C11.5 8.164 11.836 8.5 12.25 8.5L15.75 8.5C16.164 8.5 16.5 8.164 16.5 7.75L16.5 4.25C16.5 3.836 16.164 3.5 15.75 3.5L12.25 3.5C11.836 3.5 11.5 3.836 11.5 4.25Z" />
</>, 1.26));

/** Agent 扩展：一枚带两根引脚的插件；悬停时往里插一下。 */
export const PluginIcon = createNavIcon('plugin', grid20Glyph(<g className="ni-glyph">
    <line x1="10.5" y1="6.5" x2="13.5" y2="3.5" />
    <line x1="13.5" y1="9.5" x2="16.5" y2="6.5" />
    <line x1="8" y1="4" x2="16" y2="12" />
    <line x1="6" y1="14" x2="3.5" y2="16.5" />
    <polyline points="9,5 3,11 9,17 15,11" />
</g>, 1.22));

/** 技能：一卷写好的卷轴（SKILL.md 就是一卷做法），悬停时字从左往右写出来。 */
export const SkillIcon = createNavIcon('skill', grid20Glyph(<>
    <path d="M6.5 3.5C6 3.5 4.828 3.5 4 3.5C3.172 3.5 2.5 4.172 2.5 5C2.5 5.384 2.644 5.735 2.882 6" />
    <path className="ni-text" pathLength={100} d="M7.5 8.5C8 8.5 8.442 8.103 8.7 7.5C8.958 8.103 9.399 8.5 9.9 8.5C10.401 8.5 10.842 8.103 11.1 7.5C11.358 8.103 11.799 8.5 12.3 8.5C12.801 8.5 13.242 8.103 13.5 7.5" />
    <path d="M4 3.5L5.5 3.5L5.5 15C5.5 15.828 6.172 16.5 7 16.5L16 16.5C16.828 16.5 17.5 15.828 17.5 15L17.5 13.5L15.5 13.5L8.5 13.5L8.5 15C8.5 15.828 7.828 16.5 7 16.5M15.5 5L15.5 13.5M5.5 3.5L14 3.5C14.828 3.5 15.5 4.172 15.5 5" />
</>, 1.13));

/** MCP：协议标志按中线重画（整体缩到 0.81），悬停时顺着笔画再画一遍。 */
const MCP_MARK_PATHS = [
    'M1.85 11.19 11.48 1.75A3.45 3.45 0 0 1 16.29 6.47L9.07 13.55',
    'M16.53 6.55A3.29 3.29 0 1 1 21.15 11.24L11.65 20.56l2.58 2.54',
    'M13.88 4.11 6.76 11.1A3.29 3.29 0 1 0 11.58 15.82L18.7 8.83',
];

export const McpIcon = createNavIcon('mcp', enlarged(<g className="ni-glyph">
    {MCP_MARK_PATHS.map(d => <path key={d} pathLength={100} d={d} />)}
</g>, 0.87));

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

/**
 * 登录：门框在右、箭头往里走（进站）。此前这枚画的是「门在左、箭头出去」，
 * 与账户菜单的「退出登录」同形；两者左右对称，含义才分得开。
 */
export const LoginIcon = createNavIcon('login', enlarged(<>
    <path d="M13.5 5h3A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-3" />
    <g className="ni-arrow"><path d="M4.5 12h7.7M9 8.8 12.2 12 9 15.2" /></g>
</>, 1.17));

// ── Account menu icons ────────────────────────────────────────────────────
// 用户卡片（账户菜单）也走同一套图标，不再混用 lucide 的 2px 粗线。

/** 用量：半圈表盘加一根指针；悬停时指针扫一道再落回。 */
export const GaugeIcon = createNavIcon('usage', enlarged(<>
    <path d="M5.64 18.36A9 9 0 1 1 18.36 18.36" />
    <path className="ni-needle" d="M12 12 15.8 8.2" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
</>, 1.06));

/** GitHub：品牌标志保持原形，只换成同一线宽。 */
export const GithubIcon = createNavIcon('github', <g className="ni-glyph">
    <g transform="translate(1.2 1.2) scale(.9)" strokeWidth={1.778}>
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
        <path d="M9 18c-4.51 2-5-2-7-2" />
    </g>
</g>);

/** 报告错误 / 需求：气泡里一个感叹号——报错和提需求都装得下；悬停时气泡一弹。 */
export const FeedbackIcon = createNavIcon('feedback', enlarged(<g className="ni-bubble">
    <path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-7L7 20.2V17H5.5A1.5 1.5 0 0 1 4 15.5v-9A1.5 1.5 0 0 1 5.5 5z" />
    <path d="M12 8.3v3.9" />
    <path d="M12 14.6h.01" />
</g>, 1.1));

/** 退出登录：门框在左，箭头从门里出去（与「登录」左右对称）。 */
export const LogoutIcon = createNavIcon('logout', enlarged(<>
    <path d="M10.5 5h-3A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19h3" />
    <path className="ni-arrow" d="M11 12h9M16.8 8.8 20 12l-3.2 3.2" />
</>, 1.15));

/** 没有头像时的占位：半身像，落在圆形头像框里。 */
export const BustIcon = createNavIcon('bust', enlarged(<>
    <circle className="ni-head" cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
</>, 1.13));
