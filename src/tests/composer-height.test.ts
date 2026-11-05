import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSER_MAX_HEIGHT,
  resolveComposerHeight,
} from '../lib/chat/composer-height';

test('a single line keeps the compact field and offers no expand key', () => {
  assert.deepEqual(resolveComposerHeight({ natural: 32, hero: false, expanded: false, viewport: 900 }), { height: 32, expandable: false });
  assert.deepEqual(resolveComposerHeight({ natural: 42, hero: true, expanded: false, viewport: 900 }), { height: 42, expandable: false },
    'an empty hero field is two rows and still counts as one line');
});

test('a wrapped draft grows with its content instead of jumping to a fixed height', () => {
  assert.deepEqual(resolveComposerHeight({ natural: 53, hero: false, expanded: false, viewport: 900 }), { height: 53, expandable: false });
  assert.deepEqual(resolveComposerHeight({ natural: 95, hero: false, expanded: false, viewport: 900 }), { height: 95, expandable: false });
  assert.deepEqual(resolveComposerHeight({ natural: 130, hero: false, expanded: false, viewport: 900 }), { height: 130, expandable: false });
  assert.deepEqual(resolveComposerHeight({ natural: 63, hero: true, expanded: false, viewport: 900 }), { height: 63, expandable: false });
});

test('the field stops at the normal cap and only then offers expansion', () => {
  assert.deepEqual(resolveComposerHeight({ natural: COMPOSER_MAX_HEIGHT, hero: false, expanded: false, viewport: 900 }), { height: COMPOSER_MAX_HEIGHT, expandable: false });
  assert.deepEqual(resolveComposerHeight({ natural: COMPOSER_MAX_HEIGHT + 1, hero: false, expanded: false, viewport: 900 }), { height: COMPOSER_MAX_HEIGHT, expandable: true });
});

test('expanded grows in place up to a share of the window and never shrinks below the cap', () => {
  assert.deepEqual(resolveComposerHeight({ natural: 500, hero: false, expanded: true, viewport: 900 }), { height: 504, expandable: true }, 'a short draft still opens a 56% editor');
  assert.deepEqual(resolveComposerHeight({ natural: 300, hero: false, expanded: true, viewport: 900 }), { height: 504, expandable: true });
  assert.deepEqual(resolveComposerHeight({ natural: 900, hero: false, expanded: true, viewport: 900 }), { height: 648, expandable: true }, 'long drafts stop at 72%');
  assert.deepEqual(resolveComposerHeight({ natural: 500, hero: false, expanded: true, viewport: 320 }), { height: 230, expandable: true }, 'a short window stops at 72% of its height');
});
