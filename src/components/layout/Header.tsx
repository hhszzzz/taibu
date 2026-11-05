/**
 * 顶部 Header 组件（仅移动端；桌面端导航由 Sidebar 承担）
 *
 * - 根据当前路由动态显示功能图标和名称
 * - 集成认证状态显示
 */
'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
    ChevronLeft,
    MoreHorizontal,
    Moon,
    Sun,
    Megaphone,
} from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useTheme } from '@/components/ui/ThemeProvider';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useHeaderMenuSafe } from '@/components/layout/HeaderMenuContext';
import { useAnnouncementCenterSafe } from '@/components/providers/AnnouncementPopupHost';
import { useActiveSettingsCenterTab } from '@/lib/hooks/useSettingsCenterRouteState';
import { getSettingsCenterRouteTarget, isAdminSettingsCenterTab } from '@/lib/settings-center';

// 路由到标题的映射
const ROUTE_LABELS: Record<string, string> = {
    // 功能子页面
    '/bazi/result': '八字结果',
    '/ziwei/result': '紫微结果',
    '/tarot/result': '塔罗结果',
    '/tarot/history': '塔罗历史',
    '/liuyao/result': '六爻结果',
    '/liuyao/history': '六爻历史',
    '/hepan/result': '合盘结果',
    '/hepan/history': '合盘历史',
    '/face/result': '面相结果',
    '/face/history': '面相历史',
    '/palm/result': '手相结果',
    '/palm/history': '手相历史',
    '/mbti/result': 'MBTI 结果',
    '/mbti/history': 'MBTI 历史',
    '/qimen/result': '奇门结果',
    '/qimen/history': '奇门历史',
    '/daliuren/result': '大六壬结果',
    '/daliuren/history': '大六壬历史',
    '/meihua/result': '梅花结果',
    '/meihua/history': '梅花历史',
    '/xiaoliuren/result': '小六壬',
    '/xiaoliuren/history': '小六壬历史',
    // 功能主页面
    '/bazi': '八字排盘',
    '/ziwei': '紫微斗数',
    '/tarot': '塔罗占卜',
    '/liuyao': '六爻占卜',
    '/hepan': '八字合盘',
    '/face': '面相分析',
    '/palm': '手相分析',
    '/mbti': 'MBTI 性格测试',
    '/qimen': '奇门遁甲',
    '/daliuren': '大六壬',
    '/meihua': '梅花易数',
    '/xiaoliuren': '小六壬',
    '/daily': '日运 · 黄历',
    '/monthly': '月运',
    '/records': '命理记录',
    '/community': '命理社区',
    // 用户子页面
    '/user/notifications': '通知中心',
    '/user/annual-report': '年度报告',
    '/chat': 'AI 对话',
    '/privacy': '隐私政策',
    '/terms': '服务条款',
    // 六爻子页面
    '/liuyao/select': '选卦起卦',
    '/liuyao/divine': '铜钱起卦',
    // 合盘子页面
    '/hepan/create': '新建合盘',
};

const SUB_PAGE_FALLBACKS: Record<string, string> = {
    '/privacy': getSettingsCenterRouteTarget('help'),
    '/terms': getSettingsCenterRouteTarget('help'),
};

/** Longest prefix first, so sub-pages win over their parent routes. */
const ROUTE_LABEL_KEYS = Object.keys(ROUTE_LABELS).sort((a, b) => b.length - a.length);

// 需要显示返回按钮的子页面路径模式
const SUB_PAGE_PATTERNS = [
    '/user/notifications',
    '/user/annual-report',
    '/bazi/result',
    '/ziwei/result',
    '/tarot/result',
    '/tarot/history',
    '/liuyao/result',
    '/liuyao/history',
    '/liuyao/select',
    '/liuyao/divine',
    '/hepan/result',
    '/hepan/history',
    '/hepan/create',
    '/face/result',
    '/face/history',
    '/palm/result',
    '/palm/history',
    '/mbti/test',
    '/mbti/result',
    '/mbti/history',
    '/mbti/personality',
    '/qimen/result',
    '/qimen/history',
    '/daliuren/result',
    '/daliuren/history',
    '/meihua/result',
    '/meihua/history',
    '/xiaoliuren/result',
    '/xiaoliuren/history',
    '/privacy',
    '/terms',
];

export function Header() {
    const pathname = usePathname();
    const router = useRouter();
    const { theme, toggleTheme } = useTheme();
    const { user } = useSessionSafe();
    const { openAnnouncementCenter } = useAnnouncementCenterSafe();
    const headerMenuContext = useHeaderMenuSafe();
    const customMenuItems = headerMenuContext?.menuItems || [];
    const announcementMenuLabel = user ? '通知 / 公告' : '公告';
    const activeSettingsTab = useActiveSettingsCenterTab();
    const isAdminContext = !!pathname?.startsWith('/admin') || isAdminSettingsCenterTab(activeSettingsTab);

    // 获取当前页面标题
    const getPageTitle = () => {
        if (!pathname) return '太卜';
        for (const key of ROUTE_LABEL_KEYS) {
            if (pathname.startsWith(key)) {
                return ROUTE_LABELS[key];
            }
        }
        return '太卜';
    };

    // 页面可通过 useHeaderTitle 提供更具体的标题（如命盘主人姓名）
    const pageTitle = headerMenuContext?.pageTitle || getPageTitle();

    // 判断是否是子页面（需要显示返回键的页面）
    const isSubPage = pathname ? SUB_PAGE_PATTERNS.some(pattern => pathname.startsWith(pattern)) : false;

    const handleBack = () => {
        if (!pathname) {
            router.back();
            return;
        }

        const fallbackEntry = Object.entries(SUB_PAGE_FALLBACKS)
            .sort(([left], [right]) => right.length - left.length)
            .find(([prefix]) => pathname.startsWith(prefix));
        if (fallbackEntry && typeof window !== 'undefined' && window.history.length <= 1) {
            router.replace(fallbackEntry[1]);
            return;
        }

        router.back();
    };

    return (
        <>
            <header
                className="
                    fixed top-0 left-0 right-0 z-40
                    safe-top-header px-2
                    bg-background/95 backdrop-blur-md
                    flex items-center justify-between
                    lg:hidden
                "
            >
                {/* 移动端：返回键(子页面) + 居中标题 + 三点菜单 */}
                {isSubPage ? (
                    <IconButton
                        label="返回上一页"
                        onClick={handleBack}
                        className="h-11 w-11 rounded-full text-foreground"
                    >
                        <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={1.8} aria-hidden="true" />
                    </IconButton>
                ) : (
                    <div className="w-11" />
                )}

                <h1 className="max-w-[calc(100%-7rem)] truncate font-display text-[17px] font-medium text-foreground">
                    {pageTitle}
                </h1>

                <div>
                    <Menu>
                        <MenuTrigger className="inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground" aria-label="打开菜单">
                            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.8} aria-hidden="true" />
                        </MenuTrigger>
                        <MenuContent align="end" className="w-44">
                            {!isAdminContext && <>
                                <MenuItem className="gap-3 px-4 py-2.5" onClick={() => openAnnouncementCenter({ tab: user ? 'notifications' : 'announcements' })}>
                                    <Megaphone className="w-4 h-4" aria-hidden="true" />
                                    {announcementMenuLabel}
                                </MenuItem>
                                <MenuSeparator />
                            </>}
                            {/* 页面自定义菜单项 */}
                            {customMenuItems.map((item) => (
                                <MenuItem key={item.id} disabled={item.disabled} className="gap-3 px-4 py-2.5" onClick={item.onClick}>
                                    {item.icon}
                                    {item.label}
                                </MenuItem>
                            ))}
                            {customMenuItems.length > 0 && <MenuSeparator />}
                            <MenuItem className="gap-3 px-4 py-2.5" onClick={toggleTheme}>
                                {theme === 'dark' ? <><Sun className="w-4 h-4" aria-hidden="true" />切换到浅色</> : <><Moon className="w-4 h-4" aria-hidden="true" />切换到深色</>}
                            </MenuItem>
                        </MenuContent>
                    </Menu>
                </div>
            </header>
        </>
    );
}
