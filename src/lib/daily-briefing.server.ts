import 'server-only';
import type { ScopedDb } from '@/lib/db/context.server';
import { systemDb } from '@/lib/db/context.server';
import { getModelsByUsageTypeAsync } from '@/lib/server/ai-config';
import { getUserCreditInfo } from '@/lib/user/credits';
import { isModelAllowedForMembership } from '@/lib/ai/ai-access';
import { generateBriefingAgent } from '@/lib/agent/briefing.server';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
type BriefingJob = { id: string; user_id: string; local_date: string; timezone: string; lease_token: string; attempts: number };

async function generateBriefing(db: ScopedDb, job: BriefingJob, signal: AbortSignal): Promise<string> {
    if (await getGlobalAIFeatureGuardResponse()) throw new Error('AI 功能已关闭');
    const account = await getUserCreditInfo(job.user_id, {});
    const config = (await getModelsByUsageTypeAsync('chat')).find(model => isModelAllowedForMembership(model, account.membership));
    if (!config) throw new Error('没有可用的早报模型');
    return generateBriefingAgent(db, job, config, signal);
}

/** Independent scheduler only. Bound each page, concurrency, and total wall time. */
export async function processDailyBriefings(options: { db?: ScopedDb; budgetMs?: number; generate?: typeof generateBriefing } = {}) {
    const db = options.db ?? systemDb();
    if (process.env.DAILY_BRIEFING_ENABLED === 'false') {
        await db.rpc('claim_daily_briefings', { p_limit: 2, p_enabled: false });
        return { generated: 0, delivered: 0 };
    }
    const deadline = Date.now() + Math.min(options.budgetMs ?? 150_000, 150_000);
    let generated = 0;
    for (let page = 0; page < 10 && Date.now() < deadline - 5000; page++) {
        const jobs = await db.rpc('claim_daily_briefings', { p_limit: 2 }) as unknown as BriefingJob[];
        if (!jobs.length) break;
        const results = await Promise.allSettled(jobs.map(async job => {
            let content: string | null = null; let error: string | null = null;
            try { content = await (options.generate ?? generateBriefing)(db, job, AbortSignal.timeout(Math.max(1000, Math.min(120_000, deadline - Date.now())))); }
            catch (cause) { error = cause instanceof Error ? cause.message : '生成失败'; }
            const settled = await db.rpc('settle_daily_briefing', { p_id: job.id, p_token: job.lease_token, p_content: content, p_error: error });
            if (settled && content && !error) generated++;
        }));
        if (results.some(result => result.status === 'rejected')) break; // Stale leases recover without another charge.
    }
    const delivery = await db.rpc('deliver_daily_briefing_notices', { p_limit: 50 });
    return { generated, delivered: Number(delivery ?? 0) };
}
