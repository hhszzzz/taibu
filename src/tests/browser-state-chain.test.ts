import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('fetchCheckinStatus returns explicit error instead of null on request failure', async () => {
    const browserApiModule = require('../lib/browser-api') as typeof import('../lib/browser-api');
    const checkinPath = require.resolve('../components/checkin/checkin-client');
    const originalRequestBrowserJson = browserApiModule.requestBrowserJson;

    browserApiModule.requestBrowserJson = async () => ({
        data: null,
        error: { message: '认证失败' },
    });

    try {
        delete require.cache[checkinPath];
        const { fetchCheckinStatus } = require('../components/checkin/checkin-client') as typeof import('../components/checkin/checkin-client');
        const result = await fetchCheckinStatus();
        assert.deepEqual(result, {
            ok: false,
            error: { message: '认证失败' },
        });
    } finally {
        browserApiModule.requestBrowserJson = originalRequestBrowserJson;
        delete require.cache[checkinPath];
    }
});

test('getMembershipInfo returns explicit error instead of null on request failure', async () => {
    const browserApiModule = require('../lib/browser-api') as typeof import('../lib/browser-api');
    const membershipPath = require.resolve('../lib/user/membership');
    const originalRequestBrowserJson = browserApiModule.requestBrowserJson;

    browserApiModule.requestBrowserJson = async () => ({
        data: null,
        error: { message: '获取会员状态失败' },
    });

    try {
        delete require.cache[membershipPath];
        const { getMembershipInfo } = require('../lib/user/membership') as typeof import('../lib/user/membership');
        const result = await getMembershipInfo('user-1');
        assert.deepEqual(result, {
            ok: false,
            error: { message: '获取会员状态失败' },
        });
    } finally {
        browserApiModule.requestBrowserJson = originalRequestBrowserJson;
        delete require.cache[membershipPath];
    }
});

test('loadChatBootstrap throws instead of returning empty bootstrap on request failure', async () => {
    const browserApiModule = require('../lib/browser-api') as typeof import('../lib/browser-api');
    const bootstrapPath = require.resolve('../lib/chat/bootstrap');
    const originalRequestBrowserJson = browserApiModule.requestBrowserJson;

    browserApiModule.requestBrowserJson = async () => ({
        data: null,
        error: { message: '加载失败' },
    });

    try {
        delete require.cache[bootstrapPath];
        const { loadChatBootstrap } = require('../lib/chat/bootstrap') as typeof import('../lib/chat/bootstrap');
        await assert.rejects(loadChatBootstrap(), {
            message: '加载失败',
        });
    } finally {
        browserApiModule.requestBrowserJson = originalRequestBrowserJson;
        delete require.cache[bootstrapPath];
    }
});

test('getCurrentUserProfileBundle throws instead of returning null on request failure', async () => {
    const browserApiModule = require('../lib/browser-api') as typeof import('../lib/browser-api');
    const profilePath = require.resolve('../lib/user/profile');
    const originalRequestBrowserJson = browserApiModule.requestBrowserJson;

    browserApiModule.requestBrowserJson = async () => ({
        data: null,
        error: { message: '获取用户资料失败' },
    });

    try {
        delete require.cache[profilePath];
        const { getCurrentUserProfileBundle } = require('../lib/user/profile') as typeof import('../lib/user/profile');
        await assert.rejects(getCurrentUserProfileBundle(), {
            message: '获取用户资料失败',
        });
    } finally {
        browserApiModule.requestBrowserJson = originalRequestBrowserJson;
        delete require.cache[profilePath];
    }
});

test('loadAdminClientAccessState surfaces profile loading failures instead of downgrading to non-admin', async () => {
    const authModule = require('../lib/auth') as typeof import('../lib/auth');
    const profileModule = require('../lib/user/profile') as typeof import('../lib/user/profile');
    const adminClientPath = require.resolve('../lib/admin/client');
    const originalGetSession = authModule.getSession;
    const originalGetCurrentUserProfileBundle = profileModule.getCurrentUserProfileBundle;

    (authModule as { getSession: typeof import('../lib/auth').getSession }).getSession = async () => ({
        id: 'session-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    } as Awaited<ReturnType<typeof originalGetSession>>);
    (profileModule as { getCurrentUserProfileBundle: typeof import('../lib/user/profile').getCurrentUserProfileBundle }).getCurrentUserProfileBundle = async () => {
        throw new Error('获取用户资料失败');
    };

    try {
        delete require.cache[adminClientPath];
        const { loadAdminClientAccessState } = require('../lib/admin/client') as typeof import('../lib/admin/client');
        await assert.rejects(loadAdminClientAccessState(), {
            message: '获取用户资料失败',
        });
    } finally {
        (authModule as { getSession: typeof import('../lib/auth').getSession }).getSession = originalGetSession;
        (profileModule as { getCurrentUserProfileBundle: typeof import('../lib/user/profile').getCurrentUserProfileBundle }).getCurrentUserProfileBundle = originalGetCurrentUserProfileBundle;
        delete require.cache[adminClientPath];
    }
});

test('community post page separates auth failures from admin access failures', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/community/[postId]/page.tsx'), 'utf8');

    assert.match(
        source,
        /setUser\(user\);[\s\S]*try\s*\{\s*const access = await loadAdminClientAccessState\(\);[\s\S]*catch \(error\) \{\s*console\.error\('获取社区管理员状态失败:'/,
    );
    assert.match(
        source,
        /catch \(error\) \{\s*console\.error\('获取社区登录态失败:'/,
    );
});
