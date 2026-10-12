'use client';
import { usePathname } from 'next/navigation';
import { ChatSidebar } from '@/components/chat/sidebar/ChatSidebar';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settings = pathname === '/settings' || pathname.startsWith('/settings/');
  // The chat page has its own sidebar: dated conversations with task markers, folding to a rail.
  const chat = pathname === '/chat';
  // Phones show chat full screen: its header opens the same sidebar as a drawer, its composer sits at the bottom.
  const mobileChrome = !settings && !chat;
  return <>
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <div className="flex min-h-screen">
      {!settings && (chat ? <ChatSidebar /> : <Sidebar />)}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {mobileChrome && <div className="lg:hidden h-[var(--mobile-header-height)] safe-top flex-shrink-0"><Header /></div>}
        <main id="main-content" className={`flex-1 overflow-x-hidden${mobileChrome ? ' pb-20 lg:pb-0' : ''}`}>{children}</main>
      </div>
    </div>
    {mobileChrome && <MobileNav />}
  </>;
}
