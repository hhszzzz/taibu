'use client';

import { ArrowDown } from 'lucide-react';

// claude scroll-to-bottom 实测：36×36 圆形图标钮（视觉无文字，aria 名保持不变供验收锚定）。
export function JumpToLatest({ onClick }: { onClick: () => void }) {
    return <button type="button" onClick={onClick} className="chat-jump-latest" aria-label="回到最新消息" title="回到最新"><ArrowDown size={16} aria-hidden="true" /></button>;
}
