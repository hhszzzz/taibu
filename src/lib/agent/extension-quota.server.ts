import 'server-only';
import type { ScopedDb } from '@/lib/db/context.server';
import { lockTransactionKey } from '@/lib/db/sql-helpers';

/** A transaction as ScopedDb hands it out (only the db layer imports Kysely). */
type Trx = Parameters<Parameters<ScopedDb['tx']>[0]>[0];

/** The tables that hold a member's extensions under the shared policy. */
export type ExtensionTable = 'agent_mcp_servers' | 'agent_skills';

/**
 * Keeps a member at the allowance while adding one more: the oldest enabled rows are switched off first, under a
 * per-owner lock so concurrent additions cannot exceed it. Connectors and skills share this rule.
 */
export async function retireOverAllowance(
  trx: Trx,
  options: { table: ExtensionTable; owner: string; limit: number; lock: number },
) {
  await lockTransactionKey(trx, options.owner, options.lock);
  const enabled = await trx.selectFrom(options.table).select('id')
    .where('owner_id', '=', options.owner).where('is_enabled', '=', true)
    .orderBy('created_at', 'asc').limit(options.limit).execute();
  if (enabled.length < options.limit) return;
  const retire = enabled.slice(0, enabled.length - options.limit + 1).map((row) => row.id);
  await trx.updateTable(options.table).set({ is_enabled: false }).where('id', 'in', retire).execute();
}
