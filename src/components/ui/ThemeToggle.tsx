/**
 * 主题切换按钮组件
 * 
 * 'use client' 标记说明：
 * - 需要与用户交互（点击事件），必须在客户端运行
 */
'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/ui/ThemeProvider';
import { IconButton } from '@/components/ui/IconButton';

/**
 * ThemeToggle 组件
 * 点击后在深色/浅色主题之间切换
 */
export function ThemeToggle() {
    const { toggleTheme } = useTheme();

    return (
        <IconButton label="切换主题" title="切换主题" className="p-2" onClick={toggleTheme}>
            <Sun className="hidden dark:block h-5 w-5 text-foreground-secondary hover:text-accent transition-colors" aria-hidden="true" />
            <Moon className="block dark:hidden h-5 w-5 text-foreground-secondary hover:text-accent transition-colors" aria-hidden="true" />
        </IconButton>
    );
}
