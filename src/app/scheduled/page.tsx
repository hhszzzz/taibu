import { Suspense } from 'react';
import { ScheduledTasksPage } from '@/components/scheduled/ScheduledTasksPage';
import { LoginOverlay } from '@/components/auth/LoginOverlay';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

export default function ScheduledPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>}>
      <LoginOverlay message="登录后查看与管理定时任务"><ScheduledTasksPage /></LoginOverlay>
    </Suspense>
  );
}
