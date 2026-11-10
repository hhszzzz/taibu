'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { AnnouncementCard } from '@/components/notifications/AnnouncementCard';

/**
 * 换页时主内容区淡入（不重建页面树，也不加包裹层）；首屏不播放。只动透明度：
 * 位移会让 main 在动画期间成为 position: fixed 后代的包含块。
 */
function useRouteFade(pathname: string) {
  const mainRef = useRef<HTMLElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const previous = shown.current;
    shown.current = pathname;
    if (previous === null || previous === pathname || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    mainRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.165, .84, .44, 1)' });
  }, [pathname]);
  return mainRef;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mainRef = useRouteFade(pathname);
  // Public share pages are standalone read-only documents: no app navigation around them.
  if (pathname.startsWith('/share/')) return <main id="main-content">{children}</main>;
  const settings = pathname === '/settings' || pathname.startsWith('/settings/');
  // One sidebar across the app; on /chat its 最近 list switches to dated groups
  // with agent task markers (see Sidebar / ChatSidebarConversations).
  const chat = pathname === '/chat';
  // Phones show chat full screen: its header opens the conversation drawer, its composer sits at the bottom.
  const mobileChrome = !settings && !chat;
  return <>
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <div className="flex min-h-screen">
      {!settings && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {mobileChrome && <div className="lg:hidden h-[var(--mobile-header-height)] safe-top flex-shrink-0"><Header /></div>}
        {mobileChrome && <AnnouncementCard variant="banner" />}
        <main ref={mainRef} id="main-content" className={`flex-1 overflow-x-hidden${mobileChrome ? ' pb-20 lg:pb-0' : ''}`}>{children}</main>
      </div>
    </div>
    {mobileChrome && <MobileNav />}
  </>;
}
