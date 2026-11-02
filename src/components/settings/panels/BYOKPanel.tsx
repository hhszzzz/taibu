'use client';

import { useSessionSafe } from '@/components/providers/ClientProviders';
import { ByokSettings } from '@/components/settings/byok/ByokSettings';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

// 设置页标题与说明由设置中心统一渲染，面板只负责连接列表与编辑。
export default function BYOKPanel() {
  const { user, loading } = useSessionSafe();
  if (loading) {
    return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
  }
  if (!user) return <SettingsLoginRequired title="请先登录后管理自定义模型" />;
  return <ByokSettings key={user.id} userId={user.id} />;
}
