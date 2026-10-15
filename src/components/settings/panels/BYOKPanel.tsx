'use client';

import { CustomProviderPanel } from '@/components/chat/CustomProviderPanel';

// 设置页标题与说明由设置中心统一渲染，面板只负责存储说明、当前配置与编辑表单。
export default function BYOKPanel() {
  return <CustomProviderPanel embedded />;
}
