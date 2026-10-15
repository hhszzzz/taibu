/**
 * 八字合盘入口：直接展示双方信息表单（关系类型在表单内切换）
 */
import { Suspense } from 'react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { HepanCreateView } from '@/components/hepan/HepanCreateView';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';

export default function HepanPage() {
    return (
        <>
            <Suspense fallback={
                <div className="min-h-screen bg-background flex items-center justify-center">
                    <SoundWaveLoader variant="block" text="" />
                </div>
            }>
                <HepanCreateView />
            </Suspense>
            {/* 历史记录抽屉 */}
            <HistoryDrawer type="hepan" />
        </>
    );
}
