/**
 * 成员的角色徽标：协作成员与后台子分析按角色工作（体系专家、研究员、复核员或管理员定义的角色），名称旁标出角色。
 * 角色出现之前的旧记录没有角色名，不显示。
 */
import type { ParallelAnalysisResult } from '@/lib/agent/parallel-results';

export function MemberRoleBadge({ member }: { member: Pick<ParallelAnalysisResult, 'profileName'> }) {
    return member.profileName ? <span className="agent-member-role">{member.profileName}</span> : null;
}
