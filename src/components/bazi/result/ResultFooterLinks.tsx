import Link from 'next/link';
import { SettingsCenterLink } from '@/components/settings/SettingsCenterLink';

export function ResultFooterLinks() {
    return (
        <div className="mt-6 flex justify-center gap-4">
            <Link href="/bazi" className="text-sm text-foreground-secondary hover:text-accent transition-colors">
                新建排盘
            </Link>
            <span className="text-foreground-secondary">•</span>
            <SettingsCenterLink tab="charts" className="text-sm text-foreground-secondary hover:text-accent transition-colors">
                我的命盘
            </SettingsCenterLink>
        </div>
    );
}

