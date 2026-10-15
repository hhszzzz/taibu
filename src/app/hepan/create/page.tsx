/**
 * 创建合盘页面（保留旧链接 /hepan/create?type=…，内容与 /hepan 入口一致）
 */
import { Suspense } from 'react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { HepanCreateView } from '@/components/hepan/HepanCreateView';

export default function HepanCreatePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-background flex items-center justify-center">
                <SoundWaveLoader variant="block" text="" />
            </div>
        }>
            <HepanCreateView />
        </Suspense>
    );
}
