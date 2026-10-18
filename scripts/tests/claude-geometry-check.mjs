// 几何对照校验：登录本地栈后，比对 taibu 会话壳与 claude 实测值。
// 只读测量，不发送任何 AI 请求。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const project = process.env.TAIBU_PROJECT || 'taibu-agent-1006b';
const config = JSON.parse(await readFile(path.join(ROOT, '.taibu-local', project, 'config.json'), 'utf8'));
const origin = config.APP_ORIGIN || 'http://127.0.0.1:3196';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const fails = [];

const assertNear = (label, actual, expected, tol = 1) => {
    const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${actual} (期望 ${expected}±${tol})`);
    if (!ok) fails.push(`${label}=${actual}≠${expected}`);
};

try {
    await page.goto(`${origin}/chat`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByPlaceholder('邮箱前缀').fill(config.USER_EMAIL);
    await page.getByPlaceholder('输入密码').fill(config.USER_PASSWORD);
    await page.locator('form').getByRole('button', { name: '登录', exact: true }).click();
    await page.getByPlaceholder('输入密码').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForTimeout(2500);

    // ---- 空态（hero）----
    const hero = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const r = (s) => { const el = q(s); if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
        const h1 = q('.chat-empty-intro h1');
        const sym = q('.chat-empty-symbol');
        return {
            inner: r('.chat-empty-inner'),
            composer: r('.chat-composer-inner'),
            h1Font: h1 ? getComputedStyle(h1).fontSize : null,
            h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
            symFont: sym ? getComputedStyle(sym).fontSize : null,
            symBg: sym ? getComputedStyle(sym).backgroundColor : null,
            symRadius: sym ? getComputedStyle(sym).borderRadius : null,
        };
    });
    console.log('hero:', JSON.stringify(hero));
    assertNear('空态列宽（claude 1440 = 640）', hero.inner?.w, 640);
    assertNear('空态问候语字号（claude 1440 = 32px）', parseFloat(hero.h1Font), 32, 0.6);
    assertNear('空态星标字号 = 问候语字号', parseFloat(hero.symFont), parseFloat(hero.h1Font), 0.6);
    if (hero.symBg && hero.symBg !== 'rgba(0, 0, 0, 0)') fails.push(`空态星标仍有底色 ${hero.symBg}`);

    // ---- 会话内 ----
    // 最近会话列表顺序会随验收运行变化，挑第一条含助手正文的对话再测量。
    const rowLinks = page.locator('.chat-nav-row-link');
    let proseRow = -1;
    for (let index = 0; index < Math.min(await rowLinks.count(), 6); index++) {
        await rowLinks.nth(index).click();
        await page.waitForTimeout(2200);
        if (await page.locator('.chat-transcript-list .chat-prose').count()) { proseRow = index; break; }
    }
    if (proseRow >= 0) console.log(`会话正文取自第 ${proseRow + 1} 条最近对话`);
    // 工作区面板若已展开，会压缩阅读列；测量前先收起（claude 同样如此）。
    const closeWs = page.getByRole('button', { name: '关闭工作区', exact: true });
    if (await closeWs.count()) { await closeWs.first().click(); await page.waitForTimeout(600); }
    const chat = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const cs = (s, p) => { const el = q(s); return el ? getComputedStyle(el)[p] : null; };
        const box = (s) => { const el = q(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
        const header = q('.chat-session-header');
        const hcs = header ? getComputedStyle(header) : null;
        const before = header ? getComputedStyle(header, '::before') : null;
        const dock = q('.chat-composer-dock');
        const dockBefore = dock ? getComputedStyle(dock, '::before') : null;
        const status = q('.chat-composer-statusbar');
        const scs = status ? getComputedStyle(status) : null;
        const list = box('.chat-transcript-list');
        const listEl = q('.chat-transcript-list');
        const lcs = listEl ? getComputedStyle(listEl) : null;
        const proseEl = q('.chat-transcript-list .chat-prose');
        // taibu 的 MarkdownContent 把 className 挂到每个块元素上，故 .chat-prose 本身就是 <p>/<ul>/<li>。
        const pcs = proseEl ? getComputedStyle(proseEl) : null;
        const ps = [...document.querySelectorAll('.chat-transcript-list .chat-answer > p')];
        const flowSample = ps.find((p) => p !== p.parentElement.firstElementChild);
        const code = document.querySelector('.chat-transcript-list .chat-answer :not(pre) > code:not(.markdown-code)');
        const codeBlock = q('.chat-transcript-list .chat-answer .markdown-code');
        const th = q('.chat-transcript-list .chat-answer th');
        const blockquote = q('.chat-transcript-list .chat-answer blockquote');
        // 首块顶距按 cds 全局复位为 0；flow 值回退到样式表里的 .chat-answer > * 声明。
        const ruleFlow = () => {
            for (const sheet of document.styleSheets) {
                let rules = [];
                try { rules = sheet.cssRules; } catch { continue; }
                for (const r of rules) {
                    if (r.selectorText === '.chat-answer > *' && r.style?.marginTop) return r.style.marginTop;
                }
            }
            return null;
        };
        const send = box('.chat-send-button');
        const attach = q('.chat-input-attach');
        return {
            vp: [innerWidth, innerHeight],
            header: header ? { pos: hcs.position, z: hcs.zIndex, h: box('.chat-session-header')?.h, border: hcs.borderBottomWidth, pad: hcs.padding } : null,
            headerBackdrop: before ? { bg: before.backgroundColor, mask: (before.maskImage || '').slice(0, 60) } : null,
            list, listPad: lcs ? lcs.padding : null, dock: box('.chat-composer-dock'),
            dockPad: cs('.chat-composer-dock', 'paddingTop'), dockBg: cs('.chat-composer-dock', 'backgroundColor'),
            dockFade: dockBefore ? (dockBefore.backgroundImage || '').slice(0, 70) : null,
            chin: status ? { margin: scs.margin, padding: scs.padding, bg: scs.backgroundColor } : null,
            rowPad: cs('.chat-transcript-row', 'padding'),
            rows: [...document.querySelectorAll('.chat-transcript-row')].slice(0, 3).map((el) => ({
                role: el.dataset.role ?? null,
                top: parseFloat(getComputedStyle(el).paddingTop),
                bottom: parseFloat(getComputedStyle(el).paddingBottom),
            })),
            proseFont: pcs?.fontSize ?? null, proseLine: pcs?.lineHeight ?? null, prosePad: pcs?.paddingLeft ?? null,
            pMargin: flowSample ? getComputedStyle(flowSample).marginTop : ruleFlow(),
            firstPMargin: ps[0] ? getComputedStyle(ps[0]).marginTop : null,
            link: proseEl?.querySelector('a') ? { color: getComputedStyle(proseEl.querySelector('a')).color, dec: getComputedStyle(proseEl.querySelector('a')).textDecorationColor } : null,
            quote: blockquote ? { border: getComputedStyle(blockquote).borderInlineStartWidth, bg: getComputedStyle(blockquote).backgroundColor, color: getComputedStyle(blockquote).color } : null,
            inlineCode: code ? { color: getComputedStyle(code).color, radius: getComputedStyle(code).borderRadius, border: getComputedStyle(code).borderWidth, pad: getComputedStyle(code).padding, fs: getComputedStyle(code).fontSize } : null,
            pre: codeBlock ? { radius: getComputedStyle(codeBlock).borderRadius, pad: getComputedStyle(codeBlock).padding, bg: getComputedStyle(codeBlock).backgroundColor, fs: getComputedStyle(codeBlock).fontSize, border: getComputedStyle(codeBlock).borderTopWidth } : null,
            thPad: th ? getComputedStyle(th).padding : null,
            send, attach: attach ? { w: Math.round(attach.getBoundingClientRect().width), h: Math.round(attach.getBoundingClientRect().height), r: getComputedStyle(attach).borderRadius } : null,
        };
    });
    console.log('chat:', JSON.stringify(chat, null, 1));
    assertNear('会话阅读列（claude = 768）', chat.list?.w, 768);
    // padding 简写：1 值 = 四周；2/3/4 值时下标 1 都是水平值。
    const inlinePad = (() => {
        const parts = String(chat.listPad ?? '').trim().split(/\s+/).filter(Boolean);
        return parts.length > 1 ? parseFloat(parts[1]) : parseFloat(parts[0] ?? '0');
    })();
    assertNear('正文列（claude = 736）', chat.list ? chat.list.w - 2 * inlinePad : null, 736, 2);
    if (chat.header) {
        assertNear('会话头高度（claude = 48）', chat.header.h, 48);
        if (chat.header.pos !== 'absolute') fails.push(`会话头不是绝对浮层：${chat.header.pos}`);
        if (parseFloat(chat.header.border) !== 0) fails.push(`会话头仍有底边 ${chat.header.border}`);
    } else fails.push('未找到 .chat-session-header（空会话？）');
    if (chat.headerBackdrop?.mask) console.log('header backdrop mask ok');
    else fails.push('会话头缺少渐变 backdrop');
    assertNear('composer dock 顶部留白（claude = 24）', parseFloat(chat.dockPad), 24);
    // 用户要求去掉 composer 上方那条来路不明的横带（不再绘制 ::before 渐隐）。
    if (chat.dockFade && chat.dockFade !== 'none') fails.push(`composer dock 仍有上方渐隐带：${chat.dockFade}`);
    if (chat.chin) {
        const parts = chat.chin.margin.trim().split(/\s+/);
        const left = parts.length === 1 ? parts[0] : parts.length === 2 ? parts[1] : parts.length === 3 ? parts[1] : parts[3];
        assertNear('chin 左外边距（claude = -8）', parseFloat(left), -8);
        assertNear('chin 顶部内距（claude = 8）', parseFloat(chat.chin.padding.split(' ')[0]), 8);
        if (chat.chin.bg !== 'rgb(252, 252, 251)' && chat.chin.bg !== 'rgb(250, 250, 249)') fails.push(`chin 非页色底：${chat.chin.bg}`);
    } else fails.push('未找到 chin（statusbar）');
    // 轮距 = 克隆站 chat/conversation-view：user 轮 mt-6（24）、assistant 轮 mt-10（40，与 user 轮下距成对还原）、assistant→user mt-8（32）。
    const chatRows = chat.rows ?? [];
    const userRow = chatRows.find((row) => row.role === 'user');
    const assistantRow = chatRows.find((row) => row.role === 'assistant');
    if (userRow && assistantRow) {
        assertNear('user 轮上距（claude mt-6 = 24）', userRow.top, 24, 0.5);
        assertNear('user→assistant 间距（claude mt-10 = 40）', userRow.bottom + assistantRow.top, 40, 1);
        assertNear('assistant→user 间距（claude mt-8 = 32）', assistantRow.bottom + userRow.top, 32, 1);
    } else fails.push('未找到 user/assistant 轮距样本');
    assertNear('正文行高（claude = 22）', parseFloat(chat.proseLine), 22, 1);
    assertNear('文本块内缩（claude = 4）', parseFloat(chat.prosePad), 4, 0.1);
    assertNear('首块顶距（cds 全局复位 = 0）', parseFloat(chat.firstPMargin), 0, 0.1);
    assertNear('块间距（claude flow = 11.25）', parseFloat(chat.pMargin), 11.25, 0.4);
    if (chat.pre) {
        assertNear('代码块圆角（claude = 12）', parseFloat(chat.pre.radius), 12);
        assertNear('代码块内距（claude = 14）', parseFloat(chat.pre.pad), 14);
        assertNear('代码块字号（claude = 0.875em ≈ 13.1）', parseFloat(chat.pre.fs), 13.1, 0.3);
    }
    if (chat.inlineCode) {
        assertNear('行内 code 圆角（claude = .4em = 6）', parseFloat(chat.inlineCode.radius), 6, 0.6);
        assertNear('行内 code 描边（claude = 0.5px）', parseFloat(chat.inlineCode.border), 0.5, 0.01);
    }
    assertNear('发送键（claude = 32×32 r8）', chat.send?.w, 32);
    if (chat.send && parseFloat(chat.send.w) === parseFloat(chat.send.h)) console.log('PASS 发送键为正方形');
    else fails.push('发送键非正方形');

    // ---- 工作区面板（停靠分栏单形态：任务 320 / 盘面 660，挤压阅读列而不遮盖）----
    const readPanel = () => page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const g = (s, p) => { const el = q(s); return el ? getComputedStyle(el)[p] : null; };
        const b = q('.agent-panel-header')?.getBoundingClientRect();
        const tab = q('.agent-ws-tabs [role="tab"]');
        const ib = q('.agent-icon-button')?.getBoundingClientRect();
        const panel = q('.agent-workspace-panel');
        const pb = panel?.getBoundingClientRect();
        return {
            wide: panel ? Math.round(pb.width) > 400 : null,
            header: b ? { h: Math.round(b.height), pad: g('.agent-panel-header', 'padding') } : null,
            tab: tab ? { h: Math.round(tab.getBoundingClientRect().height), pad: g('.agent-ws-tabs [role="tab"]', 'padding'), fs: g('.agent-ws-tabs [role="tab"]', 'fontSize') } : null,
            icon: ib ? { w: Math.round(ib.width), h: Math.round(ib.height), r: g('.agent-icon-button', 'borderRadius') } : null,
            resizer: g('.agent-panel-resizer', 'width'),
            main: q('.chat-main')?.getBoundingClientRect().width ?? null,
            panel: pb ? { w: Math.round(pb.width), pos: g('.agent-workspace-panel', 'position'), radius: g('.agent-workspace-panel', 'borderRadius'), borderL: g('.agent-workspace-panel', 'borderInlineStartWidth'), borderT: g('.agent-workspace-panel', 'borderTopWidth'), margin: g('.agent-workspace-panel', 'margin') } : null,
            // headless Chromium 会把亚像素边框宽度吸附成整数（真实 Chrome DPR2 报 0.5px），
            // 发丝线改读样式表声明 + 根变量（与 ruleFlow 同思路）。
            hairline: (() => {
                let decl = null;
                for (const sheet of document.styleSheets) {
                    let rules = [];
                    try { rules = sheet.cssRules; } catch { continue; }
                    for (const r of rules) {
                        if (r.selectorText === '.agent-workspace-panel') decl = { w: r.style.borderInlineStartWidth, c: r.style.borderInlineStartColor, s: r.style.borderInlineStart, b: r.style.border };
                    }
                }
                return { decl, token: getComputedStyle(document.documentElement).getPropertyValue('--hairline').trim() };
            })(),
        };
    });
    const openPanel = async () => {
        const toggle = page.getByRole('button', { name: '任务工作区', exact: true });
        if (!(await toggle.count())) return null;
        // 已展开时先关掉再开，保证读到面板
        const close = page.getByRole('button', { name: '关闭工作区', exact: true });
        if (await close.count()) { await close.first().click(); await page.waitForTimeout(500); }
        await toggle.first().click();
        await page.waitForTimeout(900);
        return readPanel();
    };
    // 面板默认宽由会话内容决定：含原生盘面 660，否则 320；两种会话都取样。
    let card = null, board = null;
    for (let index = 0; index < Math.min(await rowLinks.count(), 6) && !(card && board); index++) {
        await rowLinks.nth(index).click();
        await page.waitForTimeout(2200);
        const sample = await openPanel();
        if (!sample) continue;
        if (sample.wide && !board) { board = { ...sample, row: index }; console.log('board workspace:', JSON.stringify(board)); }
        if (!sample.wide && !card) { card = { ...sample, row: index }; console.log('card workspace:', JSON.stringify(card)); }
    }
    for (const sample of [card, board].filter(Boolean)) {
        // 用户要求去掉工作区顶部的大横条：头部与标签都收窄一档（48→40 / 32→28）。
        assertNear('工作区面板头高（收窄后 = 40）', sample.header?.h, 40);
        assertNear('工作区标签高（收窄后 = 28）', sample.tab?.h, 28);
        assertNear('工作区图标键（cds = 32 r8）', sample.icon?.w, 32);
        if (sample.panel?.pos !== 'relative') fails.push(`工作区不是停靠分栏：${sample.panel?.pos}`);
        assertNear('工作区圆角（claude 卡片 = 12）', parseFloat(sample.panel?.radius ?? ''), 12, 0.5);
        const hairlineDecl = [sample.hairline?.decl?.w, sample.hairline?.decl?.c, sample.hairline?.decl?.s, sample.hairline?.decl?.b].filter(Boolean).join(' ');
        if (!hairlineDecl.includes('var(--hairline)') || !hairlineDecl.includes('var(--hairline-color)')) fails.push(`工作区发丝描边未用 hairline 变量：${hairlineDecl || '未找到声明'}`);
        assertNear('工作区发丝线（--hairline）', parseFloat(sample.hairline?.token ?? ''), 0.5, 0.01);
        assertNear('工作区卡片上留白（四周 10px）', parseFloat(String(sample.panel?.margin ?? '').split(' ')[0]), 10, 0.5);
        if (!(sample.main >= 360)) fails.push(`工作区挤压后阅读列仅 ${Math.round(sample.main ?? 0)}px（应 ≥360）`);
    }
    if (card) assertNear('任务态默认宽（小工作区 = 320）', card.panel?.w, 320);
    else fails.push('没有取样到任务态工作区');
    if (board) assertNear('盘面态默认宽（放得下十二宫盘 = 660）', board.panel?.w, 660);
    else fails.push('没有取样到盘面态工作区');
} finally {
    await browser.close();
}

console.log(fails.length ? `\n${fails.length} 项不符：\n- ${fails.join('\n- ')}` : '\n几何全部符合 claude 实测值');
process.exit(fails.length ? 1 : 0);
