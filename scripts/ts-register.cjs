const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
const _resolveCache = new Map();
// Node component tests have no CSS pipeline. Visual/style contracts run in Chrome.
require.extensions['.css'] = module => { module.exports = {}; };

function resolveAlias(request) {
    if (request === 'server-only') {
        return path.join(projectRoot, 'scripts', 'server-only-stub.js');
    }

    if (!request.startsWith('@/')) return null;

    if (_resolveCache.has(request)) return _resolveCache.get(request);

    const target = path.join(srcRoot, request.slice(2));
    const candidates = [
        target,
        `${target}.ts`,
        `${target}.tsx`,
        `${target}.js`,
        `${target}.jsx`,
        path.join(target, 'index.ts'),
        path.join(target, 'index.tsx'),
        path.join(target, 'index.js'),
        path.join(target, 'index.jsx'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            _resolveCache.set(request, candidate);
            return candidate;
        }
    }

    _resolveCache.set(request, null);
    return null;
}

function resolveTsSibling(request, parent) {
    if (!parent || !request.startsWith('.') || !request.endsWith('.js')) {
        return null;
    }

    const parentDir = path.dirname(parent.filename);
    const cacheKey = `${parentDir}\0${request}`;
    if (_resolveCache.has(cacheKey)) return _resolveCache.get(cacheKey);

    const jsTarget = path.resolve(parentDir, request);
    const tsCandidates = [
        jsTarget.replace(/\.js$/, '.ts'),
        jsTarget.replace(/\.js$/, '.tsx'),
        path.join(jsTarget.slice(0, -3), 'index.ts'),
        path.join(jsTarget.slice(0, -3), 'index.tsx'),
    ];

    for (const candidate of tsCandidates) {
        if (fs.existsSync(candidate)) {
            _resolveCache.set(cacheKey, candidate);
            return candidate;
        }
    }

    _resolveCache.set(cacheKey, null);
    return null;
}

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    // Pi publishes import-only entry points. Node >=22.19 can synchronously
    // load this ESM graph; production uses Next/esbuild's native ESM resolver.
    if (/^@earendil-works\/(?:pi-ai|pi-codemode|pi-durable|pi-mcp|pi-schema|chord)(?:\/|$)/.test(request)) {
        const [, packageName, ...subpath] = request.split('/');
        const entry = subpath.length ? subpath.join('/') : 'index';
        const target = path.join(projectRoot, 'node_modules', '@earendil-works', packageName, 'dist', entry);
        const filename = fs.existsSync(target + '.js') ? target + '.js' : path.join(target, 'index.js');
        return originalResolveFilename.call(this, filename, parent, isMain, options);
    }
    const resolved = resolveAlias(request);
    if (resolved) {
        return originalResolveFilename.call(this, resolved, parent, isMain, options);
    }
    const tsSibling = resolveTsSibling(request, parent);
    if (tsSibling) {
        return originalResolveFilename.call(this, tsSibling, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};

function compileTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2019,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
        },
        fileName: filename,
    });
    module._compile(outputText, filename);
}

Module._extensions['.ts'] = compileTs;
Module._extensions['.tsx'] = compileTs;

const isNodeTestRuntime = process.execArgv.some((arg) => arg.startsWith('--test'));
const verboseTestLogs = process.env.MINGAI_TEST_VERBOSE_LOGS === '1';

const QUIET_TEST_LOG_PATTERNS = [
    /^\[chat\] 流式读取失败:/u,
    /^\[credits\] Failed to get user info:/u,
    /^\[credits\] RPC decrement failed:/u,
    /^\[linuxdo-callback\] SignUp failed:/u,
    /^\[linuxdo-callback\] Provider insert failed:/u,
    /^\[reminders\] 创建通知失败:/u,
    /^\[ai-models\] Failed to create primary binding:/u,
    /^\[deepseek\] API error \d+:/u,
    /^\[OAuth\] consumeAuthorizationCodeAtomically: no matching code/u,
];

function shouldSuppressTestLog(args) {
    if (!isNodeTestRuntime || verboseTestLogs) return false;
    if (!Array.isArray(args) || args.length === 0) return false;

    const first = args[0];
    const lead = typeof first === 'string' ? first : '';
    if (!lead) return false;

    return QUIET_TEST_LOG_PATTERNS.some((pattern) => pattern.test(lead));
}

if (isNodeTestRuntime && !verboseTestLogs) {
    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);

    console.error = (...args) => {
        if (shouldSuppressTestLog(args)) return;
        originalError(...args);
    };

    console.warn = (...args) => {
        if (shouldSuppressTestLog(args)) return;
        originalWarn(...args);
    };
}
