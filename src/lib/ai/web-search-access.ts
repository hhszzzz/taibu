import type { MembershipType } from '@/lib/user/membership';
import { MEMBERSHIP_TIER_LABELS } from '@/lib/agent/mcp/config';

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

/**
 * The lowest membership that may search here, given the lowest tier a search service serves: never below Plus, since
 * free accounts do not search. Null when no search service is set up.
 */
export function webSearchTier(serviceTier: MembershipType | null): MembershipType | null {
    return serviceTier === null ? null : serviceTier === 'pro' ? 'pro' : 'plus';
}

/** The web toggle's title when no search service serves the member: the tier that would have one, or none set up. */
export function webSearchUnavailableTitle(tier: MembershipType | null): string {
    return tier ? `联网搜索需要 ${MEMBERSHIP_TIER_LABELS[tier]} 会员` : '当前环境未配置联网搜索';
}
