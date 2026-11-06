import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMentionToken, extractMentionTokens } from '../lib/mention-tokens';
import type { Mention } from '../types';

const mention = (name: string): Mention => ({ type: 'knowledge_base', id: name, name, preview: name });

test('a mention is written with a space after the @ so the icon keeps its gap', () => {
    assert.equal(buildMentionToken(mention('八字')), '@ 八字');
});

test('spaced tokens and legacy tokens both resolve, longest name first', () => {
    const names = [mention('八'), mention('八字'), mention('紫微')];
    assert.deepEqual(extractMentionTokens('@ 八字 和 @紫微', names), [
        { start: 0, end: 4, name: '八字' },
        { start: 7, end: 10, name: '紫微' },
    ]);
    assert.deepEqual(extractMentionTokens('@八字 和 @ 紫微', names), [
        { start: 0, end: 3, name: '八字' },
        { start: 6, end: 10, name: '紫微' },
    ]);
});

test('a bare @ or an unknown name is left as plain text', () => {
    assert.deepEqual(extractMentionTokens('@ 不存在', [mention('八字')]), []);
    assert.deepEqual(extractMentionTokens('@', [mention('八字')]), []);
    assert.deepEqual(extractMentionTokens('@ 八字', []), []);
});
