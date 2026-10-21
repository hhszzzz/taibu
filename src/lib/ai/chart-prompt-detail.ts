import 'server-only';

import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import {
  resolveChartTextDetailLevel,
  type ChartTextDetailLevel,
  type ChartTextDetailTool,
} from '@/lib/divination/detail-level';

export async function loadResolvedChartPromptDetailLevel(
  userId: string,
  tool: ChartTextDetailTool,
  options?: { db?: ScopedDb },
): Promise<ChartTextDetailLevel> {
  try {
    const db = options?.db ?? systemDb();
    const data = await db.tx((trx) => trx
      .selectFrom('user_settings')
      .select('chart_prompt_detail_level')
      .where('user_id', '=', userId)
      .executeTakeFirst());
    const saved = data?.chart_prompt_detail_level === 'full'
      ? 'full'
      : data?.chart_prompt_detail_level === 'more'
        ? 'more'
        : 'default';
    return resolveChartTextDetailLevel(tool, saved);
  } catch {
    return resolveChartTextDetailLevel(tool, 'default');
  }
}
