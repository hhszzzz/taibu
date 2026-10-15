/**
 * Header 菜单上下文
 *
 * 允许子页面向 Header 的三点菜单注入自定义菜单项，并覆盖移动端顶栏标题
 */
'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export interface HeaderMenuItem {
    id: string;
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    disabled?: boolean;
}

interface HeaderMenuContextType {
    menuItems: HeaderMenuItem[];
    setMenuItems: (items: HeaderMenuItem[]) => void;
    clearMenuItems: () => void;
    /** 页面提供的移动端顶栏标题；null 时使用路由默认标题 */
    pageTitle: string | null;
    setPageTitle: (title: string | null) => void;
}

const HeaderMenuContext = createContext<HeaderMenuContextType | null>(null);

export function HeaderMenuProvider({ children }: { children: ReactNode }) {
    const [menuItems, setMenuItemsState] = useState<HeaderMenuItem[]>([]);
    const [pageTitle, setPageTitle] = useState<string | null>(null);

    const setMenuItems = useCallback((items: HeaderMenuItem[]) => {
        setMenuItemsState(items);
    }, []);

    const clearMenuItems = useCallback(() => {
        setMenuItemsState([]);
    }, []);

    return (
        <HeaderMenuContext.Provider value={{ menuItems, setMenuItems, clearMenuItems, pageTitle, setPageTitle }}>
            {children}
        </HeaderMenuContext.Provider>
    );
}

export function useHeaderMenu() {
    const context = useContext(HeaderMenuContext);
    if (!context) {
        throw new Error('useHeaderMenu must be used within HeaderMenuProvider');
    }
    return context;
}

export function useHeaderMenuSafe() {
    return useContext(HeaderMenuContext);
}

/**
 * 在页面挂载期间覆盖移动端顶栏标题（如「林知夏的紫微命盘」）；
 * 传入空值或页面卸载时恢复路由默认标题。Provider 缺失时静默忽略。
 */
export function useHeaderTitle(title: string | null | undefined) {
    const setPageTitle = useContext(HeaderMenuContext)?.setPageTitle;
    const normalizedTitle = title?.trim() || null;

    useEffect(() => {
        if (!setPageTitle) return;
        setPageTitle(normalizedTitle);
        return () => setPageTitle(null);
    }, [setPageTitle, normalizedTitle]);
}
