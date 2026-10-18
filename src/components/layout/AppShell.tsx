'use client';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
        <main id="main-content" className={`flex-1 overflow-x-hidden${mobileChrome ? ' pb-20 lg:pb-0' : ''}`}>{children}</main>
      </div>
    </div>
    {mobileChrome && <MobileNav />}
  </>;
}
