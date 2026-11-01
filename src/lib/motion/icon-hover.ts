'use client';

/**
 * 导航图标的悬停动效：指针在一个链接或按钮上停一会儿，其中的图标做一小段与本义相关的动作，
 * 播完即止——八字阴阳流转、奇门洛书飞宫、小六壬掐指一圈、大六壬流水、面相眨眼……
 *
 * 为什么不用 `:hover` 关键帧：指针中途离开时 CSS 动画会被撤掉，图标弹回原位；扫过整列侧栏时
 * 尤其明显。这里用 WAAPI，一旦开始就播完。另外加了「悬停意图」：要在同一个链接上停留
 * `HOVER_INTENT` 毫秒才触发，扫过去不播，鼠标只是路过也不会闪。
 *
 * 为什么不设 `transform-box` / `transform-origin`：Chromium 对 SVG `<g>` 的原点支持不可靠，
 * 显式写哪种都会被算到画布左上角，一转整枚就甩出格。所以旋转、缩放一律用 `spin()` 把绕点的
 * 位移烘进 `transform`，和平移一样不受原点影响。
 *
 * 可动部件（`ni-*` 类名）见 `lib/navigation/nav-icons.tsx`；时长为毫秒，缓动沿用 entrance.ts。
 */
import { useEffect } from 'react';
import { MOTION_EASE_OUT, MOTION_EASE_OVERSHOOT, prefersReducedMotion } from './entrance';

export type IconMotion = {
    /** 图标里要动的部件。 */
    part: string;
    /** 同一类部件可按序号给出不同关键帧（如日运三道芒各朝一个方向）。 */
    keyframes: Keyframe[] | ((index: number) => Keyframe[]);
    options: KeyframeAnimationOptions;
    /** 同类部件逐个错开的毫秒数；`fromEnd` 时从最后一个开始。 */
    stagger?: number;
    fromEnd?: boolean;
};

/** 先回拉再越过终点。 */
const EASE_SWING = 'cubic-bezier(.68, -.4, .32, 1.4)';
const EASE_IN_OUT = 'cubic-bezier(.45, 0, .25, 1)';

/**
 * 绕 (cx, cy) 转 / 缩放：每一项是一段完整的变换，可选给 `offset`。
 * 绕点位移写进 transform 本身，所以不依赖也不受 `transform-box` 影响。
 */
const spin = (cx: number, cy: number, stops: ReadonlyArray<readonly [string, number?]>, easing = EASE_IN_OUT): Keyframe[] =>
    stops.map(([op, offset], index) => ({
        transform: `translate(${cx}px, ${cy}px) ${op} translate(${-cx}px, ${-cy}px)`,
        offset: offset ?? index / (stops.length - 1),
        easing,
    }));

/** 整枚转起来并停在对称角（阴阳鱼、∞、星形、罗盘都靠「转完还是原样」）。 */
const wholeTurn = (cx: number, cy: number, turns: ReadonlyArray<readonly [number, number?]>): Keyframe[] =>
    spin(cx, cy, turns.map(([angle, offset]) => [`rotate(${angle}deg)`, offset] as const), EASE_SWING);

/** 只在关键帧处跳变、中间不过渡：飞宫、掐指这类一格一跳的动作。 */
const hops = (values: string[], property: string): Keyframe[] =>
    values.map((value, index) => ({ [property]: value, offset: index / (values.length - 1), easing: 'steps(1, end)' }));

/** 奇门九宫每格边长（QimenIcon：16 宽三等分）。 */
const PALACE = 16 / 3;
/** 洛书飞宫：中五 → 乾六 → 兑七 → 艮八 → 离九 → 坎一 → 坤二 → 震三 → 巽四 → 回中五（上南下北、左东右西）。 */
const LUOSHU_FLIGHT = [[0, 0], [1, 1], [1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [-1, 0], [-1, -1], [0, 0]];
/** 每落一宫停留的毫秒数。 */
const QIMEN_HOP = 68;
/** 小六壬落宫每跳一宫（60°）停留的毫秒数。 */
const XIAOLIUREN_HOP = 85;

/** 掀一页：命理记录与命盘共用，像翻开一叠盘。 */
const PAGE_FLIP: readonly IconMotion[] = [{ part: '.ni-glyph', keyframes: spin(5, 19, [['rotate(0deg)'], ['rotate(-13deg)', .34], ['rotate(4deg)', .66], ['rotate(0deg)']]), options: { duration: 620 } }];

/** 日运三道芒（左、中、右）各自朝外的方向。 */
const RAY_OUT = ['-1.4px -1.4px', '0 -2px', '1.4px -1.4px'];

/** 简单位移：首尾回原位。 */
const float = (peak: string, peakOffset = .42): Keyframe[] => [
    { translate: '0 0', offset: 0, easing: EASE_IN_OUT },
    { translate: peak, offset: peakOffset, easing: EASE_IN_OUT },
    { translate: '0 0', offset: 1 },
];

export const ICON_MOTIONS: Readonly<Record<string, readonly IconMotion[]>> = {
    // 阴阳流转：先回拉、再转过半圈；阴阳鱼中心对称，停在 180° 与起点一致。
    bazi: [{ part: '.ni-glyph', keyframes: wholeTurn(128, 128, [[0], [180]]), options: { duration: 720 } }],

    // 两盘相合：两圆向中间靠拢，交集随之鼓起，再各自弹回。
    hepan: [
        { part: '.ni-left', keyframes: float('1.3px 0'), options: { duration: 640 } },
        { part: '.ni-right', keyframes: float('-1.3px 0'), options: { duration: 640 } },
        { part: '.ni-lens', keyframes: spin(12, 12, [['scale(1 1)'], ['scale(1.5 1.14)', .42], ['scale(.89 .96)', .72], ['scale(1 1)']]), options: { duration: 640 } },
    ],

    // 紫微即北极星：罗盘一甩，摆几下定向；罗盘星四向对称，停在 90° 与起点一致。
    ziwei: [{ part: '.ni-glyph', keyframes: spin(128, 128, [['rotate(0deg)'], ['rotate(112deg)', .36], ['rotate(82deg)', .58], ['rotate(95deg)', .76], ['rotate(88deg)', .9], ['rotate(90deg)']], MOTION_EASE_OUT), options: { duration: 860 } }],

    // 翻牌：牌面收成一线再展开，星在翻回时闪一下（四芒星转 90° 与起点一致）。
    tarot: [
        { part: '.ni-card', keyframes: spin(12, 12, [['scale(1 1)'], ['scale(.08 1)', .4], ['scale(1 1)']]), options: { duration: 620 } },
        { part: '.ni-star', keyframes: spin(12, 12, [['scale(1) rotate(0deg)'], ['scale(.3) rotate(0deg)', .4], ['scale(1.3) rotate(90deg)', .78], ['scale(1) rotate(90deg)']]), options: { duration: 620 } },
    ],

    // 起卦：自初爻（最下）往上，一爻一爻收拢再弹开。
    // 起卦：六爻自上而下依次「亮」一遍（初爻在最下，所以从最后一爻开始），像逐爻翻卦。
    // 只缩放不位移：横线本来就在中线上，横向缩放在端头看不出来。
    liuyao: [{
        part: '.ni-yao',
        fromEnd: true,
        stagger: 60,
        keyframes: [
            { opacity: 1, transform: 'translate(12px, 12px) scaleX(1) translate(-12px, -12px)', offset: 0, easing: MOTION_EASE_OUT },
            { opacity: .35, transform: 'translate(12px, 12px) scaleX(.72) translate(-12px, -12px)', offset: .35, easing: EASE_IN_OUT },
            { opacity: 1, transform: 'translate(12px, 12px) scaleX(1.04) translate(-12px, -12px)', offset: .7, easing: EASE_IN_OUT },
            { opacity: 1, transform: 'translate(12px, 12px) scaleX(1) translate(-12px, -12px)', offset: 1 },
        ],
        options: { duration: 380 },
    }],

    // 洛书飞宫：中宫一格按九宫顺序跳一圈回到中五，每落一宫轻轻一弹。
    qimen: [
        { part: '.ni-palace', keyframes: hops(LUOSHU_FLIGHT.map(([x, y]) => `${(x * PALACE).toFixed(2)}px ${(y * PALACE).toFixed(2)}px`), 'translate'), options: { duration: QIMEN_HOP * (LUOSHU_FLIGHT.length - 1) } },
        { part: '.ni-palace', keyframes: spin(12, 12, [['scale(.55)'], ['scale(1)']], MOTION_EASE_OUT), options: { duration: QIMEN_HOP, iterations: LUOSHU_FLIGHT.length - 1 } },
    ],

    // 壬水流动：两道水纹先后右移一个波长，波峰流过、两端不动（原理见 DaliurenIcon）。
    daliuren: [{
        part: '.ni-wave',
        stagger: 110,
        keyframes: [
            { translate: '0 0', strokeDashoffset: -100, offset: 0, easing: EASE_IN_OUT },
            { translate: '5.4px 0', strokeDashoffset: 0, offset: 1 },
        ],
        options: { duration: 820 },
    }],

    // 梅开：五瓣顺时针依次向外一绽，花心随之一亮。
    meihua: [
        { part: '.ni-petal', stagger: 45, keyframes: spin(12, 12, [['translate(0, 0) scale(1)'], ['translate(0, -1.8px) scale(1.06)', .4], ['translate(0, .3px) scale(1)', .72], ['translate(0, 0) scale(1)']]), options: { duration: 480 } },
        { part: '.ni-core', keyframes: spin(12, 12.4, [['scale(1)'], ['scale(1.7)', .35], ['scale(1)']]), options: { duration: 420 } },
    ],

    // 掐指一算：落宫从大安起顺时针一宫一跳，转一圈回到大安，每落一宫轻轻一弹。
    xiaoliuren: [
        {
            part: '.ni-count',
            keyframes: hops([0, 60, 120, 180, 240, 300, 360].map(angle => `translate(12px, 12px) rotate(${angle}deg) translate(-12px, -12px)`), 'transform'),
            options: { duration: XIAOLIUREN_HOP * 6 },
        },
        { part: '.ni-cursor', keyframes: spin(12, 4.8, [['scale(.4)'], ['scale(1)']], MOTION_EASE_OVERSHOOT), options: { duration: XIAOLIUREN_HOP, iterations: 6 } },
    ],

    // 面相：歪一下头，中途眨一次眼。
    face: [
        { part: '.ni-face', keyframes: spin(12, 21, [['rotate(0deg)'], ['rotate(-9deg)', .3], ['rotate(6deg)', .62], ['rotate(0deg)']]), options: { duration: 640 } },
        {
            part: '.ni-eye',
            keyframes: index => spin([9.4, 14.6][index] ?? 12, 10.4, [['scale(1 1)'], ['scale(1 1)', .38], ['scale(1 .12)', .46], ['scale(1 1)', .56], ['scale(1 1)']]),
            options: { duration: 640 },
        },
    ],

    // 手相：以腕为轴挥一挥手。
    palm: [{ part: '.ni-palm', keyframes: spin(12, 22, [['rotate(0deg)'], ['rotate(-11deg)', .24], ['rotate(8deg)', .5], ['rotate(-4deg)', .74], ['rotate(0deg)']]), options: { duration: 720 } }],

    // MBTI：四个象限顺时针逐块亮一下，扫过四个维度。
    mbti: [{ part: '.ni-quad', stagger: 85, keyframes: [{ opacity: 0, offset: 0, easing: MOTION_EASE_OUT }, { opacity: .85, offset: .3, easing: MOTION_EASE_OUT }, { opacity: 0, offset: 1 }], options: { duration: 380 } }],

    // 日出：太阳升起再落回，三道芒随之向外一放。
    daily: [
        { part: '.ni-sun', keyframes: float('0 -2px', .45), options: { duration: 620 } },
        { part: '.ni-ray', keyframes: index => float(RAY_OUT[index] ?? '0 0', .45), options: { duration: 520, delay: 90 } },
    ],

    // 月运：残月摇一摇，星星一闪（十字星转 90° 与起点一致）。
    monthly: [
        { part: '.ni-moon', keyframes: spin(12, 12, [['rotate(0deg)'], ['rotate(-18deg)', .38], ['rotate(7deg)', .7], ['rotate(0deg)']]), options: { duration: 680 } },
        { part: '.ni-star', keyframes: spin(17.4, 5.8, [['scale(1) rotate(0deg)'], ['scale(0) rotate(0deg)', .25], ['scale(1.35) rotate(90deg)', .65], ['scale(1) rotate(90deg)']]), options: { duration: 680 } },
    ],

    // 太乙：中宫先亮，再一圈圈向外荡开。
    taiyi: [0, 1, 2].map(ring => ({ part: `.ni-ring-${ring}`, keyframes: spin(12, 12, [['scale(1)'], ['scale(1.4)', .4], ['scale(1)']]), options: { duration: 420, delay: ring * 90 } })),

    // 占星：宫位十字转过一象限（四向对称，停在 90° 与起点一致）。
    astrology: [{ part: '.ni-cross', keyframes: wholeTurn(12, 12, [[0], [90]]), options: { duration: 640 } }],

    // 社区：主位点一下头，旁边那位凑近一点。
    community: [
        { part: '.ni-person', keyframes: float('0 1.2px', .36), options: { duration: 560 } },
        {
            part: '.ni-peer',
            keyframes: [
                { translate: '0 0', opacity: 1, offset: 0, easing: EASE_IN_OUT },
                { translate: '-1px .6px', opacity: .55, offset: .36, easing: EASE_IN_OUT },
                { translate: '0 0', opacity: 1, offset: 1 },
            ],
            options: { duration: 560, delay: 70 },
        },
    ],

    // ── 工具与设置 ────────────────────────────────────────────────────────
    // ∞ 的语义是流动：横向一伸一收。不转——这枚图形中心对称，转 180° 起止完全重合，
    // 中途还会变成竖着的 8 字，看着像翻跟头。
    agent: [{
        part: '.ni-glyph',
        keyframes: spin(128, 128, [['scaleX(1)'], ['scaleX(1.1)', .42], ['scaleX(.97)', .75], ['scaleX(1)']]),
        options: { duration: 620 },
    }],

    // 新聊天：气泡一弹、往上浮一下。
    chat: [{ part: '.ni-bubble', keyframes: spin(12, 12, [['translate(0, 0) scale(1)'], ['translate(0, -1.2px) scale(1.1)', .42], ['translate(0, .2px) scale(1)', .74], ['translate(0, 0) scale(1)']]), options: { duration: 560 } }],

    // 定时任务：表盘不转，指针绕轴走一整圈，像表针扫过一格。
    schedule: [{ part: '.ni-hand', keyframes: wholeTurn(12, 12, [[0], [360]]), options: { duration: 720 } }],

    // 我的：圈里的人像点一下头。
    profile: [{ part: '.ni-head', keyframes: float('0 1.2px', .36), options: { duration: 520 } }],

    // 设置：八齿齿轮转过一格 45°，齿对齿，停在原位。
    settings: [{ part: '.ni-glyph', keyframes: spin(12, 12, [['rotate(0deg)'], ['rotate(51deg)', .42], ['rotate(43deg)', .7], ['rotate(45deg)']], MOTION_EASE_OUT), options: { duration: 700 } }],

    // 钱包：卡片从卡槽里抽出来又插回去。
    billing: [{ part: '.ni-card', keyframes: float('0 -1.4px', .4), options: { duration: 560 } }],

    // 命理记录：一叠页，像翻卡片一样掀一下。
    records: PAGE_FLIP,

    // 命盘：中宫亮一下，像落了一颗星。
    charts: [{ part: '.ni-palace', keyframes: [{ opacity: 0, offset: 0, easing: MOTION_EASE_OUT }, { opacity: .3, offset: .42, easing: MOTION_EASE_OUT }, { opacity: 0, offset: 1 }], options: { duration: 760 } }],

    // 个性化：笔尖落纸一压，墨痕跟着画出来。
    personalization: [
        { part: '.ni-brush', keyframes: spin(12, 12, [['rotate(0deg)'], ['rotate(-7deg)', .34], ['rotate(3deg)', .7], ['rotate(0deg)']]), options: { duration: 620 } },
        {
            part: '.ni-ink',
            keyframes: [
                { strokeDasharray: '100 100', strokeDashoffset: 100, offset: 0, easing: EASE_IN_OUT },
                { strokeDasharray: '100 100', strokeDashoffset: 0, offset: 1 },
            ],
            options: { duration: 560, delay: 140 },
        },
    ],

    // 通知：铃身以顶上挂点为中心摇两下，铃舌慢半拍跟着摆。
    bell: [
        { part: '.ni-bell', keyframes: spin(12, 4.4, [['rotate(0deg)'], ['rotate(-15deg)', .24], ['rotate(12deg)', .5], ['rotate(-6deg)', .74], ['rotate(0deg)']]), options: { duration: 620 } },
        { part: '.ni-clapper', keyframes: spin(12, 17, [['rotate(0deg)'], ['rotate(-9deg)', .38], ['rotate(7deg)', .62], ['rotate(0deg)']]), options: { duration: 620, delay: 90 } },
    ],

    // 知识库：两页从书底的书脊向外掀一下，像刚翻开（书在 20 网格，绕点也按 20 网格取）。
    knowledge: [
        { part: '.ni-page-left', keyframes: spin(10, 16, [['rotate(0deg)'], ['rotate(8deg)', .4], ['rotate(0deg)']]), options: { duration: 560 } },
        { part: '.ni-page-right', keyframes: spin(10, 16, [['rotate(0deg)'], ['rotate(-8deg)', .4], ['rotate(0deg)']]), options: { duration: 560 } },
    ],

    // 帮助：救生圈转过一格（辐条每 90° 一圈）。
    help: [{ part: '.ni-glyph', keyframes: wholeTurn(12, 12, [[0], [90]]), options: { duration: 760 } }],

    // 钥匙：绕中心一拧，像开锁。
    key: [{ part: '.ni-glyph', keyframes: spin(12, 12, [['rotate(0deg)'], ['rotate(-18deg)', .34], ['rotate(6deg)', .7], ['rotate(0deg)']]), options: { duration: 620 } }],

    // 分享链接：两环向中间扣一下再松开。
    'share-link': [
        { part: '.ni-link-a', keyframes: float('-1px 1px', .4), options: { duration: 560 } },
        { part: '.ni-link-b', keyframes: float('1px -1px', .4), options: { duration: 560 } },
    ],

    // 公告：喇叭扬起，声波向外一荡。
    megaphone: [
        { part: '.ni-horn', keyframes: spin(5.2, 12, [['rotate(0deg)'], ['rotate(-7deg)', .34], ['rotate(0deg)']]), options: { duration: 560 } },
        {
            part: '.ni-sound',
            keyframes: [
                { translate: '0 0', opacity: 1, offset: 0, easing: EASE_IN_OUT },
                { translate: '1.3px 0', opacity: .45, offset: .45, easing: EASE_IN_OUT },
                { translate: '0 0', opacity: 1, offset: 1 },
            ],
            options: { duration: 560 },
        },
    ],

    // 功能开关：票券歪一下，像撕下来又贴回。
    'feature-flags': [{ part: '.ni-glyph', keyframes: spin(12, 12, [['rotate(0deg)'], ['rotate(-7deg)', .34], ['rotate(2deg)', .7], ['rotate(0deg)']]), options: { duration: 600 } }],

    // AI 服务：两台机器的指示灯先后亮一下。
    server: [{
        part: '.ni-led',
        stagger: 150,
        keyframes: [
            { opacity: 1, offset: 0, easing: MOTION_EASE_OUT },
            { opacity: .15, offset: .32, easing: MOTION_EASE_OUT },
            { opacity: 1, offset: .68 },
            { opacity: 1, offset: 1 },
        ],
        options: { duration: 460 },
    }],

    // 技能：卷轴上的字从左往右写一遍（pathLength 已归一到 100）。
    skill: [{
        part: '.ni-text',
        keyframes: [
            { strokeDasharray: '100 100', strokeDashoffset: 100, offset: 0, easing: EASE_IN_OUT },
            { strokeDasharray: '100 100', strokeDashoffset: 0, offset: 1 },
        ],
        options: { duration: 720 },
    }],

    // 连接器：待接的那一块卡进来（坐标是 20 网格）。
    connectors: [{ part: '.ni-plug', keyframes: float('-0.9px 0.9px', .42), options: { duration: 620 } }],

    // Agent 扩展：插头往里插一下。
    plugin: [{ part: '.ni-glyph', keyframes: float('-0.6px 0.6px', .42), options: { duration: 560 } }],

    // MCP：标志顺着笔画再画一遍（pathLength 已归一到 100）。
    mcp: [{
        part: '.ni-glyph',
        keyframes: [
            { strokeDasharray: '100 100', strokeDashoffset: 100, offset: 0, easing: EASE_IN_OUT },
            { strokeDasharray: '100 100', strokeDashoffset: 0, offset: 1 },
        ],
        options: { duration: 860 },
    }],

    // 搜索：镜片扫一下，像探头找东西。
    search: [{ part: '.ni-glyph', keyframes: spin(11, 11, [['rotate(0deg)'], ['rotate(-12deg)', .32], ['rotate(7deg)', .68], ['rotate(0deg)']]), options: { duration: 560 } }],

    // 新建：一弹。不转：十字转到一半会像个「×」，看着像关闭按钮。
    plus: [{ part: '.ni-glyph', keyframes: spin(12, 12, [['scale(1)'], ['scale(1.25)', .35], ['scale(.93)', .7], ['scale(1)']], MOTION_EASE_OUT), options: { duration: 520 } }],

    // 全部占术：四宫逐格亮一下。
    'all-divinations': [{ part: '.ni-cell', stagger: 60, keyframes: [{ opacity: 1, offset: 0, easing: MOTION_EASE_OUT }, { opacity: .3, offset: .4, easing: MOTION_EASE_OUT }, { opacity: 1, offset: 1 }], options: { duration: 340 } }],

    // 发送（输入框里那个回车箭头不是图标组件，直接标了 data-nav-icon）：往回缩一下再送出去。
    send: [{ part: 'svg', keyframes: [{ transform: 'translate(0, 0)', offset: 0, easing: EASE_IN_OUT }, { transform: 'translate(0, 1.2px)', offset: .3, easing: EASE_IN_OUT }, { transform: 'translate(0, -1px)', offset: .66, easing: EASE_IN_OUT }, { transform: 'translate(0, 0)', offset: 1 }], options: { duration: 520 } }],

    // 登录：箭头往门里推一下。
    login: [{ part: '.ni-arrow', keyframes: float('1.1px 0', .4), options: { duration: 520 } }],

    // ── 账户菜单 ──────────────────────────────────────────────────────────
    // 用量：指针扫一道再落回。
    usage: [{ part: '.ni-needle', keyframes: spin(12, 12, [['rotate(0deg)'], ['rotate(-58deg)', .36], ['rotate(22deg)', .64], ['rotate(-5deg)', .84], ['rotate(0deg)']]), options: { duration: 760 } }],

    // GitHub：轻轻一弹。
    github: [{ part: '.ni-glyph', keyframes: spin(12, 12, [['scale(1)'], ['scale(1.09)', .4], ['scale(1)']], MOTION_EASE_OUT), options: { duration: 460 } }],

    // 报告错误 / 需求：气泡弹一下。
    feedback: [{ part: '.ni-bubble', keyframes: spin(12, 12, [['translate(0, 0) scale(1)'], ['translate(0, -1px) scale(1.06)', .4], ['translate(0, 0) scale(1)']]), options: { duration: 520 } }],

    // 退出登录：箭头从门里出去。
    logout: [{ part: '.ni-arrow', keyframes: float('2.4px 0', .4), options: { duration: 520 } }],

    // 无头像：点一下头。
    bust: [{ part: '.ni-head', keyframes: float('0 1.2px', .36), options: { duration: 520 } }],
};

/** 悬停多久才开播：扫过侧栏、鼠标路过都不触发。 */
const HOVER_INTENT = 420;

// ── lucide 图标（全站的工具类图标几乎都来自这里）────────────────────────────
// lucide 会把自己渲染成 `<svg class="lucide lucide-plus">`，名字就在类名里，所以不用改上百个
// 组件就能统一挂动效。这些图标没有可拆的部件，动效作用在整个 `<svg>` 元素上——元素级变换的
// 原点就是盒子中心，不受 SVG 内部原点问题影响。

/** 弹一下。 */
const pop = (peak = 1.16): Keyframe[] => [
    { transform: 'scale(1)', offset: 0, easing: MOTION_EASE_OUT },
    { transform: `scale(${peak})`, offset: .4, easing: EASE_IN_OUT },
    { transform: 'scale(1)', offset: 1 },
];

/** 歪一下再回正。 */
const tilt = (angle = -12): Keyframe[] => [
    { transform: 'rotate(0deg)', offset: 0, easing: EASE_IN_OUT },
    { transform: `rotate(${angle}deg)`, offset: .35, easing: EASE_IN_OUT },
    { transform: `rotate(${angle / 3.5}deg)`, offset: .7, easing: EASE_IN_OUT },
    { transform: 'rotate(0deg)', offset: 1 },
];

/** 朝一个方向轻轻一推。 */
const nudge = (dx: number, dy: number): Keyframe[] => [
    { transform: 'translate(0, 0)', offset: 0, easing: EASE_IN_OUT },
    { transform: `translate(${dx}px, ${dy}px)`, offset: .38, easing: EASE_IN_OUT },
    { transform: 'translate(0, 0)', offset: 1 },
];

/** 转半圈（十字、叉、加号这类四向对称的图形，转完与起点一样）。 */
const halfTurn = (): Keyframe[] => [
    { transform: 'rotate(0deg)', offset: 0, easing: EASE_SWING },
    { transform: 'rotate(180deg)', offset: 1 },
];

const LUCIDE_MOTIONS: Readonly<Record<string, Keyframe[]>> = {
    plus: pop(1.22),
    x: halfTurn(),
    check: pop(1.24),
    search: tilt(-12),
    'panel-left': nudge(-1.4, 0),
    'panel-right': nudge(1.4, 0),
    'chevron-down': nudge(0, 1.4),
    'chevron-up': nudge(0, -1.4),
    'chevron-left': nudge(-1.4, 0),
    'chevron-right': nudge(1.4, 0),
    'arrow-left': nudge(-1.6, 0),
    'arrow-right': nudge(1.6, 0),
    'arrow-up': nudge(0, -1.6),
    'arrow-down': nudge(0, 1.6),
    'arrow-up-right': nudge(1.2, -1.2),
    'log-in': nudge(1.8, 0),
    'refresh-cw': halfTurn(),
    'rotate-ccw': [{ transform: 'rotate(0deg)', offset: 0, easing: EASE_SWING }, { transform: 'rotate(-180deg)', offset: 1 }],
    'key-round': tilt(-16),
    'lock-keyhole': tilt(-8),
    'book-open': pop(1.1),
    'book-open-text': pop(1.1),
    globe: tilt(-9),
    brain: pop(1.12),
    paperclip: tilt(-14),
    'trash-2': tilt(-10),
    archive: nudge(0, 1.4),
    pin: tilt(-12),
    'square-pen': tilt(-10),
    'ellipsis': pop(1.12),
    'message-square': pop(1.1),
    'messages-square': pop(1.1),
    'user-round': nudge(0, -1.2),
    users: pop(1.1),
    settings: tilt(-14),
    'share-2': pop(1.12),
    link2: nudge(-1.2, 1.2),
    copy: pop(1.14),
    'circle-help': tilt(-10),
    'loader-circle': halfTurn(),
    'file-text': tilt(-8),
    'folder': nudge(0, 1),
};

/** 其余 lucide 图标统一极轻的一弹，不抢戏。 */
const FALLBACK: Keyframe[] = [
    { transform: 'scale(1)', offset: 0, easing: MOTION_EASE_OUT },
    { transform: 'scale(1.08)', offset: .4, easing: EASE_IN_OUT },
    { transform: 'scale(1)', offset: 1 },
];

/** 播放一枚 lucide 图标的动效（作用在整个 svg 元素上）。 */
export function playLucideMotion(svg: Element) {
    if (playing.has(svg) || prefersReducedMotion()) return;
    const name = [...svg.classList].find(className => className.startsWith('lucide-'))?.slice('lucide-'.length) ?? '';
    const animation = svg.animate(LUCIDE_MOTIONS[name] ?? FALLBACK, { duration: 420 });
    playing.add(svg);
    void animation.finished.then(() => playing.delete(svg), () => playing.delete(svg));
}

const playing = new WeakSet<Element>();
const pending = new WeakMap<Element, number>();

/** 立即播放一枚图标的动效；没有定义动效、正在播放或用户要求减弱动态效果时什么也不做。 */
export function playIconMotion(icon: Element) {
    const motions = ICON_MOTIONS[icon.getAttribute('data-nav-icon') ?? ''];
    if (!motions || playing.has(icon) || prefersReducedMotion()) return;
    const animations = motions.flatMap(({ part, keyframes, options, stagger = 0, fromEnd = false }) => {
        // 部件选择器也可能指图标本身（输入框里那个发送箭头就是整个 svg）。
        const parts = [...(icon.matches(part) ? [icon] : []), ...icon.querySelectorAll(part)];
        return parts.map((element, index) => element.animate(
            typeof keyframes === 'function' ? keyframes(index) : keyframes,
            { ...options, delay: (options.delay ?? 0) + (fromEnd ? parts.length - 1 - index : index) * stagger },
        ));
    });
    if (!animations.length) return;
    playing.add(icon);
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => playing.delete(icon));
}

/** 指针进入这些元素时，其中的图标算被悬停；不在任何可交互元素里的图标，悬停在它本身上才算。 */
const ICON_HOSTS = 'a[href], button, summary, label, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]';

/** 全站只挂一次（ClientProviders）。触屏点按不算悬停；停留够久才播，中途离开就取消。 */
export function useIconHoverMotion() {
    useEffect(() => {
        const cancel = (host: Element) => {
            const timer = pending.get(host);
            if (timer === undefined) return;
            window.clearTimeout(timer);
            pending.delete(host);
        };

        const onPointerOver = (event: PointerEvent) => {
            if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
            const host = event.target.closest(ICON_HOSTS) ?? event.target.closest('svg[data-nav-icon], svg[class*="lucide-"]');
            // 在同一宿主内部移动（从文字移到图标）不算重新进入，也不打断已排队的播放。
            if (!host || (event.relatedTarget instanceof Node && host.contains(event.relatedTarget))) return;
            const own = host.matches('svg[data-nav-icon], svg[class*="lucide-"]') ? [host] : [];
            const icons = [...own, ...host.querySelectorAll('svg[data-nav-icon], svg[class*="lucide-"]')];
            if (!icons.length || pending.has(host)) return;
            pending.set(host, window.setTimeout(() => {
                pending.delete(host);
                for (const icon of icons) {
                    if (icon.hasAttribute('data-nav-icon')) playIconMotion(icon);
                    else playLucideMotion(icon);
                }
            }, HOVER_INTENT));
        };

        const onPointerOut = (event: PointerEvent) => {
            if (!(event.target instanceof Element)) return;
            const host = event.target.closest(ICON_HOSTS) ?? event.target.closest('svg[data-nav-icon], svg[class*="lucide-"]');
            if (!host || (event.relatedTarget instanceof Node && host.contains(event.relatedTarget))) return;
            cancel(host);
        };

        document.addEventListener('pointerover', onPointerOver);
        document.addEventListener('pointerout', onPointerOut);
        return () => {
            document.removeEventListener('pointerover', onPointerOver);
            document.removeEventListener('pointerout', onPointerOut);
        };
    }, []);
}
