import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { CreateKeyParams } from '../lib/user/activation-keys';

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
    const apiUtils = require('../lib/api-utils') as any;
    const original = apiUtils.getSystemAdminClient;
    const inserts: InsertedRow[][] = [];
    apiUtils.getSystemAdminClient = () => ({
        from(table: string) {
            assert.equal(table, 'activation_keys');
            return {
                insert(rows: InsertedRow[]) {
                    inserts.push(rows);
                    return {
                        select: async () => ({ data: rows.map(row => ({ key_code: row.key_code })), error: null }),
                    };
                },
            };
        },
    });
    t.after(() => {
        apiUtils.getSystemAdminClient = original;
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
