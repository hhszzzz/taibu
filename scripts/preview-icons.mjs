#!/usr/bin/env node
/**
 * 图标预览：把 `src/lib/navigation/nav-icons.tsx` 里的全部图标渲成一张静态页，
 * 附侧栏实况、关键线放大图与悬停动效逐帧，用来判断整套图标是否一样大、动得是否对。
 *
 *   pnpm icons:preview          # 打包并在 http://127.0.0.1:4173 起预览
 *   pnpm icons:preview --port 5000
 *   pnpm icons:preview --build  # 只产出静态文件到 .icon-preview/
 *
 * 只读 src，不改任何业务代码，也不需要 Next 构建或本地栈。
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, '.icon-preview');

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 4173;
const BUILD_ONLY = args.includes('--build');

const ENTRY = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Nav from '@/lib/navigation/nav-icons';
import { playIconMotion, useIconHoverMotion } from '@/lib/motion/icon-hover';

// 占术入口按侧栏顺序排列；工具与设置图标单列在后面。
const DIVINATION = [
  ['八字', 'BaziIcon'], ['八字合盘', 'HepanIcon'], ['紫微斗数', 'ZiweiIcon'], ['塔罗', 'TarotIcon'],
  ['六爻', 'LiuyaoIcon'], ['奇门遁甲', 'QimenIcon'], ['大六壬', 'DaliurenIcon'], ['梅花易数', 'MeihuaIcon'],
  ['小六壬', 'XiaoliurenIcon'], ['面相', 'FaceIcon'], ['手相', 'PalmIcon'], ['MBTI 测试', 'MbtiIcon'],
  ['日运', 'DailyIcon'], ['月运', 'MonthlyIcon'],
];
const EXTRA = [
  ['太乙', 'TaiyiIcon'], ['占星', 'AstrologyIcon'], ['Agent', 'AgentIcon'],
  ['新聊天', 'ChatIcon'], ['命理记录', 'RecordsIcon'], ['社区', 'CommunityIcon'],
  ['通知', 'BellIcon'], ['全部占术', 'AllDivinationsIcon'], ['搜索', 'SearchIcon'], ['新建', 'PlusIcon'], ['登录', 'LoginIcon'],
];
// 设置中心与账户菜单（与设置侧栏同一顺序）。
const SETTINGS = [
  ['账户', 'ProfileIcon'], ['常规', 'SettingsIcon'], ['钱包', 'BillingIcon'], ['用量日志', 'GaugeIcon'], ['分享链接', 'ShareLinkIcon'], ['帮助', 'HelpIcon'],
  ['个性化', 'PersonalizationIcon'], ['自定义模型', 'KeyIcon'], ['命盘', 'ChartsIcon'], ['知识库', 'KnowledgeIcon'],
  ['技能', 'SkillIcon'], ['连接器', 'ConnectorsIcon'], ['MCP', 'McpIcon'],
  ['公告', 'MegaphoneIcon'], ['功能开关', 'FeatureFlagsIcon'], ['AI 服务', 'ServerIcon'], ['Agent 扩展', 'PluginIcon'],
];
const ACCOUNT = [
  ['用量', 'GaugeIcon'], ['GitHub', 'GithubIcon'], ['报告错误/需求', 'FeedbackIcon'], ['退出登录', 'LogoutIcon'], ['头像兜底', 'BustIcon'],
];
const SIZES = [16, 20, 24];

// 关键线：圆 r=9、方 16×16、竖 14×18、横 20×12（描边中心线），与 nav-icons.tsx 顶部注释一致。
const KEYLINES = (
  <svg className="keylines" viewBox="0 0 24 24" fill="none" strokeWidth="0.08">
    <circle cx="12" cy="12" r="9" />
    <rect x="4" y="4" width="16" height="16" />
    <rect x="5" y="3" width="14" height="18" />
    <rect x="2" y="6" width="20" height="12" />
  </svg>
);

function Row({ label, name }) {
  const Icon = Nav[name];
  return (
    <div className="row">
      <span className="lbl">{label}</span>
      <span className="sizes">{SIZES.map(s => <span key={s}><Icon size={s} /></span>)}</span>
      <span className="zoom">{KEYLINES}<Icon size={96} /></span>
    </div>
  );
}

// 侧栏实况：与 Sidebar.tsx 同样 20px 图标 + 14px 文字，判断「一样大」最直接的地方。
function SidebarMock({ items }) {
  return (
    <nav className="sidebar">
      {items.map(([l, n]) => {
        const Icon = Nav[n];
        return <div key={n} className="nav"><span className="ico"><Icon size={20} /></span>{l}</div>;
      })}
    </nav>
  );
}

// 逐帧：同一图标排一行，各自暂停在动效的第 k/(FRAMES-1) 处，一眼看完整段动作。
const FRAMES = 8;
function Filmstrip({ label, name }) {
  const Icon = Nav[name];
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const icons = [...ref.current.querySelectorAll('svg[data-nav-icon]')];
    icons.forEach((icon, k) => {
      playIconMotion(icon);
      const animations = icon.getAnimations({ subtree: true });
      const end = Math.max(0, ...animations.map(a => a.effect.getComputedTiming().endTime));
      for (const a of animations) {
        // 动效都会停在起点（fill 默认 none），逐帧里要保留最后一刻的状态。
        a.effect.updateTiming({ fill: 'forwards' });
        a.pause();
        a.currentTime = end * k / (FRAMES - 1);
      }
    });
  }, []);
  return (
    <div className="film" ref={ref}>
      <span className="lbl">{label}</span>
      {Array.from({ length: FRAMES }, (_, k) => <Icon key={k} size={40} />)}
    </div>
  );
}

function App() {
  useIconHoverMotion();
  return (
    <main>
      <h1>占术图标预览</h1>
      <p className="hint">
        左侧是侧栏实况（20px）；右侧每行为 16 / 20 / 24 px 和 96px 放大，
        淡色线是关键线（圆、方、竖、横四种基本形）。悬停 0.42 秒后图标才开播。
      </p>
      <div className="layout">
        <SidebarMock items={DIVINATION} />
        <div>
          <div className="group">{DIVINATION.map(([l, n]) => <Row key={n} label={l} name={n} />)}</div>
          <h2>工具</h2>
          <div className="group">{EXTRA.map(([l, n]) => <Row key={n} label={l} name={n} />)}</div>
          <h2>设置中心</h2>
          <div className="group">{SETTINGS.map(([l, n]) => <Row key={n} label={l} name={n} />)}</div>
          <h2>账户菜单</h2>
          <div className="group">{ACCOUNT.map(([l, n]) => <Row key={n} label={l} name={n} />)}</div>
          <h2>悬停动效逐帧（从左到右 {FRAMES} 帧；悬停上面任一行看实时效果）</h2>
          <div className="group">
            {[...DIVINATION, ...EXTRA, ...SETTINGS, ...ACCOUNT, ['太乙', 'TaiyiIcon'], ['占星', 'AstrologyIcon']].map(([l, n]) => <Filmstrip key={n} label={l} name={n} />)}
          </div>
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
`;

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>占术图标预览</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #faf9f5; color: #2b2823;
         font: 14px/1.5 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { padding: 28px 32px 48px; max-width: 980px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 6px; }
  h2 { font-size: 13px; font-weight: 600; color: #6b665c; margin: 26px 0 8px; }
  .hint { margin: 0 0 18px; font-size: 12px; color: #8a857a; }
  .layout { display: grid; grid-template-columns: 200px 1fr; gap: 24px; align-items: start; }
  .sidebar { position: sticky; top: 16px; background: #f3f1ea; border-radius: 12px; padding: 8px; }
  .nav { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px; border-radius: 8px;
         font-size: 14px; color: #2b2823; }
  .nav .ico { display: flex; width: 28px; justify-content: center; color: #5a564e; }
  .group { background: #fff; border: 1px solid #e9e5da; border-radius: 12px; padding: 4px 14px; }
  .row { display: grid; grid-template-columns: 80px 1fr 104px; align-items: center;
         gap: 12px; padding: 6px 0; border-bottom: 1px solid #f1eee5; }
  .row:last-child { border-bottom: 0; }
  .lbl { font-size: 12px; color: #5a564e; }
  .sizes { display: flex; align-items: center; gap: 22px; color: #2b2823; }
  .sizes span { display: flex; align-items: center; justify-content: center; }
  .zoom { position: relative; width: 96px; height: 96px; color: #2b2823; }
  .zoom > svg { position: absolute; inset: 0; }
  .keylines { stroke: #e08a6a; opacity: .55; width: 96px; height: 96px; }
  .film { display: flex; align-items: center; gap: 14px; padding: 8px 0; border-bottom: 1px solid #f1eee5; color: #2b2823; }
  .film:last-child { border-bottom: 0; }
  .film .lbl { width: 80px; flex-shrink: 0; }
</style>
</head>
<body><div id="root"></div><script src="app.js"></script></body>
</html>
`;

async function bundle() {
    const { build } = await import('esbuild');
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(resolve(OUT_DIR, 'entry.jsx'), ENTRY);
    await writeFile(resolve(OUT_DIR, 'index.html'), PAGE);
    await build({
        entryPoints: [resolve(OUT_DIR, 'entry.jsx')],
        outfile: resolve(OUT_DIR, 'app.js'),
        bundle: true,
        format: 'iife',
        jsx: 'automatic',
        loader: { '.tsx': 'tsx' },
        define: { 'process.env.NODE_ENV': '"production"' },
        alias: { '@': resolve(ROOT, 'src') },
        logLevel: 'warning',
    });
    return OUT_DIR;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

await bundle();
const address = `http://127.0.0.1:${PORT}`;

if (BUILD_ONLY) {
    console.log(`图标预览已生成：${OUT_DIR}/index.html`);
    process.exit(0);
}

const server = createServer(async (req, res) => {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
        const body = await readFile(resolve(OUT_DIR, `.${path}`));
        res.writeHead(200, { 'content-type': TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 被占用，换一个：pnpm icons:preview --port 4174`);
        process.exit(1);
    }
    throw error;
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`占术图标预览：${address}`);
    console.log('改完 nav-icons.tsx 后刷新页面即可（重新运行本命令会重新打包）。');
});
