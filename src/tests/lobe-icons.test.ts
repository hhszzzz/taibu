import test from 'node:test';
import assert from 'node:assert/strict';
import { LOBE_ICONS, isLobeIconId, searchLobeIcons } from '../lib/ai/lobe-icons';

test('only generated lobehub ids are accepted', () => {
  assert.equal(isLobeIconId('OpenAI'), true);
  assert.equal(isLobeIconId('Claude'), true);
  assert.equal(isLobeIconId('MysteryIcon'), false);
  assert.equal(isLobeIconId(''), false);
  assert.equal(isLobeIconId(null), false);
  assert.equal(isLobeIconId(42), false);
});

test('an empty search lists the catalog from the start and honours the limit', () => {
  assert.deepEqual(searchLobeIcons('', 5).map(icon => icon.id), LOBE_ICONS.slice(0, 5).map(icon => icon.id));
  assert.equal(searchLobeIcons('').length, Math.min(60, LOBE_ICONS.length));
  assert.equal(searchLobeIcons('', 3).length, 3);
});

test('search ranks exact ids above prefixes and substrings, case-insensitively', () => {
  const adobe = searchLobeIcons('adobe');
  assert.equal(adobe[0]?.id, 'Adobe');
  assert.ok(adobe.some(icon => icon.id === 'AdobeFirefly'), 'the prefix entry is still listed');

  const claude = searchLobeIcons('CLAUDE');
  assert.equal(claude[0]?.id, 'Claude');

  const gpt = searchLobeIcons('gpt');
  assert.ok(gpt.length > 0);
  assert.ok(gpt.every(icon => icon.id.toLowerCase().includes('gpt') || icon.title.toLowerCase().includes('gpt')));
  assert.deepEqual(searchLobeIcons('definitely-not-an-icon'), []);
  assert.equal(searchLobeIcons('deepseek')[0]?.id, 'DeepSeek');
  assert.equal(searchLobeIcons('gemini')[0]?.id, 'Gemini');
});
