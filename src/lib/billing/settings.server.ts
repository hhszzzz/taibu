import 'server-only';

import { createSharedCache } from '@/lib/cache/shared.server';
import { systemDb } from '@/lib/db/context.server';
import { json } from '@/lib/db/sql-helpers';
import { BILLING_SETTINGS_KEY, normalizeBillingSettings, type BillingSettings } from './config';

const billingSettingsCache = createSharedCache<BillingSettings>({ name: 'billing-settings', ttlMs: 30_000 });

/** The stored settings, or the defaults when none were saved. Throws when the database cannot be read. */
export async function getBillingSettings(): Promise<BillingSettings> {
    return billingSettingsCache.load(async () => {
        const row = await systemDb().tx((trx) => trx.selectFrom('app_settings').select('setting_value')
            .where('setting_key', '=', BILLING_SETTINGS_KEY).executeTakeFirst());
        return normalizeBillingSettings(row?.setting_value);
    });
}

export async function setBillingSettings(settings: BillingSettings): Promise<void> {
    const updatedAt = new Date().toISOString();
    await systemDb().tx((trx) => trx.insertInto('app_settings')
        .values({ setting_key: BILLING_SETTINGS_KEY, setting_value: json(settings) as never, updated_at: updatedAt })
        .onConflict((conflict) => conflict.column('setting_key').doUpdateSet({ setting_value: json(settings) as never, updated_at: updatedAt }))
        .execute());
    await billingSettingsCache.invalidate();
}
