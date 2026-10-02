import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { DATA_SOURCE_TYPES } from '../lib/data-sources/types';
import { getEnabledDataSourceTypes } from '../lib/data-sources/catalog';
import { DATA_SOURCE_LOADERS } from '../lib/data-sources/manifest';

const sourceDirectory = path.join(process.cwd(), 'src/lib/data-sources');

function source(file: string): string {
    return readFileSync(path.join(sourceDirectory, file), 'utf8');
}

test('browser data-source DTOs/catalog neither import nor re-export server provider types', () => {
    for (const file of ['types.ts', 'catalog.ts', 'icon-catalog.ts']) {
        const text = source(file);
        assert.doesNotMatch(text, /SupabaseClient|@supabase|provider\.server|data-sources\/manifest|lib\/api-utils/);
    }
    assert.deepEqual(getEnabledDataSourceTypes(() => true), [...DATA_SOURCE_TYPES]);
    assert.deepEqual(Object.keys(DATA_SOURCE_LOADERS), [...DATA_SOURCE_TYPES]);
});

test('provider contract imports are type-only and erased at runtime', () => {
    const contract = source('provider.server.ts');
    const ast = ts.createSourceFile('provider.server.ts', contract, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
        if (ts.isImportDeclaration(statement)) assert.equal(statement.importClause?.isTypeOnly, true);
    }
    const emitted = ts.transpileModule(contract, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    assert.doesNotMatch(emitted, /require\(/);
});

// tsc owns missing/relocated provider-type exports across all consumers. The
// source-replacement dependency boundary is enforced by test:guards; its narrow
// persistence behavior is exercised by knowledge-base-persistence.test.ts.
