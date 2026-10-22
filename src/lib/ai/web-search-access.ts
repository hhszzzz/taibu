import type { MembershipType } from '@/lib/user/membership';

/** Plain chat web search: Plus and Pro may search; only Pro may also attach a document to the same message. */
export function chatWebSearchAccess(membership: MembershipType): { search: boolean; withDocument: boolean } {
    return { search: membership !== 'free', withDocument: membership === 'pro' };
}

/** Why this message may not search the web, or null when it may. */
export function chatWebSearchDenial(membership: MembershipType, withDocument: boolean): string | null {
    const access = chatWebSearchAccess(membership);
    if (!access.search) return '免费用户无法使用网络搜索功能，请升级会员';
    if (withDocument && !access.withDocument) return 'Plus 会员无法同时使用文件和搜索，请升级 Pro 会员';
    return null;
}
