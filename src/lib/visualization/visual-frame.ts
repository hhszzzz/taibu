/**
 * ```visual 的沙箱外壳。
 *
 * iframe 只给 allow-scripts，不给 allow-same-origin：内容处于不透明源，
 * 读不到站点 Cookie 与存储；外壳里的 CSP 再禁止联网与外部资源。
 */

/** 主题变量按父页当前计算值注入，暗色主题随 CSS 变量一起切换。 */
export const VISUAL_THEME_VARIABLES = [
    '--color-background',
    '--color-background-secondary',
    '--color-background-tertiary',
    '--color-foreground',
    '--color-foreground-secondary',
    '--color-foreground-tertiary',
    '--color-border',
    '--color-accent',
    '--color-accent-soft',
    '--color-accent-strong',
    '--color-success',
    '--color-warning',
    '--color-danger',
    '--font-sans',
    '--font-mono',
] as const;

export type VisualTheme = Partial<Record<(typeof VISUAL_THEME_VARIABLES)[number], string>>;

export const VISUAL_FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

export const VISUAL_FRAME_MIN_HEIGHT = 80;
export const VISUAL_FRAME_MAX_HEIGHT = 4000;

const FALLBACK_THEME: VisualTheme = {
    '--color-background': '#ffffff',
    '--color-background-secondary': '#f5f5f4',
    '--color-background-tertiary': '#eceae6',
    '--color-foreground': '#1f1f1f',
    '--color-foreground-secondary': '#57534e',
    '--color-foreground-tertiary': '#8a8580',
    '--color-border': '#d9d6d0',
    '--color-accent': '#b8860b',
    '--font-sans': 'system-ui, -apple-system, "PingFang SC", sans-serif',
};

/** 把高度限制在父页允许的范围内，避免内容撑破会话。 */
export function clampVisualHeight(value: unknown): number | null {
    const height = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(height)) return null;
    return Math.min(VISUAL_FRAME_MAX_HEIGHT, Math.max(VISUAL_FRAME_MIN_HEIGHT, Math.round(height)));
}

function themeStyle(theme: VisualTheme): string {
    const declarations: string[] = [];
    for (const [name, value] of Object.entries({ ...FALLBACK_THEME, ...theme })) {
        if (!name.startsWith('--') || typeof value !== 'string' || !value.trim()) continue;
        declarations.push(`${name}:${value.replace(/[;{}<>]/gu, '')}`);
    }
    return declarations.join(';');
}

/** 外壳脚本：上报内容高度，并接受父页的主题更新。 */
const SHELL_SCRIPT = `(function () {
  function post() {
    var height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    parent.postMessage({ type: 'taibu-visual:height', height: height }, '*');
  }
  window.addEventListener('load', post);
  window.addEventListener('resize', post);
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(post);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  }
  setTimeout(post, 0);
  setTimeout(post, 120);
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'taibu-visual:theme' || !data.vars) return;
    for (var name in data.vars) {
      if (name.indexOf('--') === 0 && typeof data.vars[name] === 'string') {
        document.documentElement.style.setProperty(name, data.vars[name]);
      }
    }
    setTimeout(post, 0);
  });
})();`;

/** 生成 srcdoc：CSP、主题变量、内容与高度上报脚本。 */
export function buildVisualSrcdoc(html: string, theme: VisualTheme = {}): string {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`
        + `<meta http-equiv="Content-Security-Policy" content="${VISUAL_FRAME_CSP}">`
        + `<meta name="viewport" content="width=device-width, initial-scale=1">`
        + `<style>:root{${themeStyle(theme)}}*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent;color:var(--color-foreground);font-family:var(--font-sans);font-size:14px;line-height:1.6}body{padding:12px;overflow:hidden}img,svg{max-width:100%}</style>`
        + `</head><body>${html}<script>${SHELL_SCRIPT}</script></body></html>`;
}

/** 从父页读取主题变量；服务端渲染时返回空对象，由客户端挂载后补齐。 */
export function readVisualTheme(): VisualTheme {
    if (typeof document === 'undefined') return {};
    const styles = getComputedStyle(document.documentElement);
    const theme: VisualTheme = {};
    for (const name of VISUAL_THEME_VARIABLES) {
        const value = styles.getPropertyValue(name).trim();
        if (value) theme[name] = value;
    }
    return theme;
}
