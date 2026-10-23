import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { CreateKeyParams } from '../lib/user/activation-keys';
import { createMockScopedDb } from './helpers/db-mock';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';

type InsertedRow = {
    key_code: string;
    key_type: string;
    membership_type: string | null;
    credits_amount: number | null;
    created_by: string;
};

function mockAdminClient(t: TestContext) {
    const contextModule = require('../lib/db/context.server') as any;
    const original = contextModule.systemDb;
    const inserts: InsertedRow[][] = [];
    contextModule.systemDb = () => createMockScopedDb({
        tx: (work) => work({
            insertInto: () => ({
                values: (rows: InsertedRow[]) => {
                    inserts.push(rows);
                    return {
                        returning: () => ({
                            execute: async () => rows.map(row => ({ key_code: row.key_code })),
                        }),
                    };
                },
            }),
        } as never),
    });
    t.after(() => {
        contextModule.systemDb = original;
    });
    return inserts;
}

test('activation codes use the sk- prefix with 16 lowercase letters or digits', async () => {
    const { generateKeyCode } = await import('../lib/user/activation-keys');
    const codes = Array.from({ length: 2000 }, () => generateKeyCode());

    assert.equal(codes.every(code => /^sk-[a-z0-9]{16}$/u.test(code)), true);
    assert.equal(new Set(codes).size, codes.length);
});

test('activation codes come from crypto randomness, not Math.random', async (t) => {
    const { generateKeyCode } = await import('../lib/user/activation-keys');
    // 旧实现在 Math.random 恒为 0 时只会生成 sk-aaaaaaaaaaaaaaaa。
    t.mock.method(Math, 'random', () => 0);

    const first = generateKeyCode();
    const second = generateKeyCode();

    assert.notEqual(first, 'sk-aaaaaaaaaaaaaaaa');
    assert.notEqual(first, second);
});

test('createActivationKeys inserts exactly the requested number of keys', async (t) => {
    const inserts = mockAdminClient(t);
    const { createActivationKeys } = await import('../lib/user/activation-keys');

    const credits = await createActivationKeys('admin-1', { keyType: 'credits', creditsAmount: 20, count: 3 });
    const plus = await createActivationKeys('admin-1', { keyType: 'membership', membershipType: 'plus', count: 1 });

    assert.equal(credits.success, true);
    assert.equal(credits.keys?.length, 3);
    assert.deepEqual(
        inserts[0].map(row => [row.key_type, row.membership_type, row.credits_amount, row.created_by]),
        Array.from({ length: 3 }, () => ['credits', null, 20, 'admin-1']),
    );
    assert.equal(plus.success, true);
    assert.deepEqual(
        inserts[1].map(row => [row.key_type, row.membership_type, row.credits_amount]),
        [['membership', 'plus', null]],
    );
});

test('createActivationKeys rejects fractional or out-of-range input before writing', async (t) => {
    const inserts = mockAdminClient(t);
    const { createActivationKeys } = await import('../lib/user/activation-keys');
    const cases: Array<[CreateKeyParams, string]> = [
        [{ keyType: 'invalid' as CreateKeyParams['keyType'], count: 1 }, '激活码类型无效'],
        // 小数数量过去会让循环多生成一个激活码。
        [{ keyType: 'credits', creditsAmount: 20, count: 1.5 }, '创建数量需在1-100之间'],
        [{ keyType: 'membership', membershipType: 'pro', count: 0 }, '创建数量需在1-100之间'],
        [{ keyType: 'membership', membershipType: 'pro', count: 101 }, '创建数量需在1-100之间'],
        [{ keyType: 'credits', creditsAmount: 2.5, count: 1 }, '积分类型Key需要指定有效的积分数量'],
        [{ keyType: 'credits', creditsAmount: 0, count: 1 }, '积分类型Key需要指定有效的积分数量'],
        [{ keyType: 'credits', count: 1 }, '积分类型Key需要指定有效的积分数量'],
        [{ keyType: 'membership', membershipType: 'free', count: 1 }, '会员类型Key需要指定会员等级'],
        [{ keyType: 'membership', count: 1 }, '会员类型Key需要指定会员等级'],
    ];

    for (const [params, error] of cases) {
        assert.deepEqual(await createActivationKeys('admin-1', params), { success: false, error }, JSON.stringify(params));
    }
    assert.equal(inserts.length, 0);
});

test('activation storage failures propagate instead of becoming empty lists or business rejections', async t => {
    const context = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
    const { createActivationKeys, getAllActivationKeys, deleteActivationKey, activateKey } = await import('../lib/user/activation-keys');
    t.mock.method(console, 'error', () => {});
    t.mock.method(context, 'systemDb', () => createMockScopedDb({
        tx: async () => { throw new Error('storage unavailable'); },
        rpc: async () => { throw new Error('storage unavailable'); },
    }));
    await assert.rejects(createActivationKeys('admin-1', { keyType: 'credits', creditsAmount: 20, count: 1 }), /storage unavailable/);
    await assert.rejects(getAllActivationKeys(), /storage unavailable/);
    await assert.rejects(deleteActivationKey('key-1'), /storage unavailable/);
    await assert.rejects(activateKey('user-1', 'sk-validfixture'), /storage unavailable/);
});
