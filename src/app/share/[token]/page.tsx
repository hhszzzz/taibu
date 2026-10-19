/**
 * 公开只读分享页：凭 43 位令牌匿名读取一份对话快照。
 *
 * 未知、已删除与格式错误的令牌一律 404；页面不被收录、不向外站泄露来源地址。
 */
import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SharedConversationView } from '@/components/chat/SharedConversationView';
import { loadPublicShare } from '@/lib/chat/conversation-share.server';

export const dynamic = 'force-dynamic';

type SharePageProps = { params: Promise<{ token: string }> };

// generateMetadata and the page share one lookup per request.
const loadShare = cache((token: string) => loadPublicShare(token));

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
    const { token } = await params;
    const share = await loadShare(token);
    return {
        title: share ? share.title : '分享不存在',
        robots: { index: false, follow: false },
        referrer: 'no-referrer',
    };
}

export default async function SharedConversationPage({ params }: SharePageProps) {
    const { token } = await params;
    const share = await loadShare(token);
    if (!share) notFound();
    return <SharedConversationView share={share} />;
}
