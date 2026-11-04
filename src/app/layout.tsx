/**
 * 根布局组件
 * 
 * 这是 Next.js App Router 的根布局文件
 * 所有页面都会被这个布局包裹
 * 
 * 服务端组件说明：
 * - 这个文件默认是服务端组件（没有 'use client'）
 * - 可以直接获取 metadata 等服务端特性
 * - 客户端组件（如 ThemeProvider）会自动在边界处进行水合
 */

import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import Loading from "./loading";

import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { HeaderMenuProvider } from "@/components/layout/HeaderMenuContext";
import { ConversationListProvider } from "@/lib/chat/ConversationListContext";
import { AppShell } from "@/components/layout/AppShell";
import { ClientProviders } from "@/components/providers/ClientProviders";
import { SettingsCenterHost } from "@/components/settings/SettingsCenterHost";

const themeInitScript = `
(() => {
  const parseStoredValue = (key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'value' in parsed) {
        return parsed.value ?? null;
      }
      return parsed;
    } catch {
      return raw;
    }
  };

  window.localStorage.removeItem('mingai.pref.themeMode');
  window.localStorage.removeItem('mingai.pref.theme');

  const storedThemeMode = parseStoredValue('taibu.pref.themeMode');
  const legacyTheme = parseStoredValue('taibu.pref.theme');
  const themeMode =
    storedThemeMode === 'light' || storedThemeMode === 'dark' || storedThemeMode === 'system'
      ? storedThemeMode
      : legacyTheme === 'light' || legacyTheme === 'dark'
        ? legacyTheme
        : 'system';

  const theme =
    themeMode === 'dark'
      ? 'dark'
      : themeMode === 'light'
        ? 'light'
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';

  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;

  const themeColorMetas = document.querySelectorAll('meta[name="theme-color"]');
  themeColorMetas.forEach((meta) => {
    meta.setAttribute('content', theme === 'dark' ? '#151515' : '#fcfcfb');
  });
})();
`;

// SEO 元数据配置
export const metadata: Metadata = {
  title: {
    default: "太卜",
    template: "%s | 太卜"
  },
  description: "将传统命理文化与前沿AI技术深度融合，为您提供专业、私密、便捷的命理咨询服务。八字精批、紫微斗数、塔罗占卜等多种命理体系。",
  keywords: ["命理", "八字", "AI算命", "紫微斗数", "塔罗", "运势", "命盘分析"],
  authors: [{ name: "太卜" }],
  creator: "太卜",
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "太卜",
    title: "太卜",
    description: "AI 驱动的命理分析与占术解读，记忆式对话与可核查的排盘依据",
  },
  twitter: {
    card: "summary_large_image",
    title: "太卜",
    description: "AI驱动的个性化命理分析",
  },
  icons: {
    icon: [
      {
        url: "/tab-icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
  },
};

// 视口配置
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#151515" },
  ],
};

/**
 * 根布局组件
 * 
 * 布局结构：
 * - 桌面端：左侧固定侧边栏 + 右侧内容区（带顶部 Header）
 * - 移动端：顶部 Header + 内容区 + 底部导航栏
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className="antialiased min-h-screen"
      >
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* ThemeProvider 提供主题上下文，包裹整个应用 */}
        <ThemeProvider>
          <ClientProviders>
            <ConversationListProvider>
              <HeaderMenuProvider>
                <AppShell>
                      {/* Give streamed route children their own hydration boundary. */}
                      <Suspense fallback={<Loading />}>
                        {children}
                      </Suspense>
                </AppShell>
                <SettingsCenterHost />
            </HeaderMenuProvider>
          </ConversationListProvider>
          </ClientProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
