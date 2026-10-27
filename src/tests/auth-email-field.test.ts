import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailField } from '../components/auth/LoginForm';
import { isCompleteEmail, normalizeAuthEmail } from '../lib/auth/email';

for (const [input, expected, complete] of [
    ['  demo@taibu.local  ', 'demo@taibu.local', true],
    ['admin@mingai.fun', 'admin@mingai.fun', true],
    ['alice', 'alice', false],
    ['alice@qq', 'alice@qq', false],
    ['alice @qq.com', 'alice @qq.com', false],
    ['', '', false],
] as const) {
    test(`auth email keeps the typed address and only drops surrounding spaces: ${JSON.stringify(input)}`, () => {
        assert.equal(normalizeAuthEmail(input), expected);
        assert.equal(isCompleteEmail(input), complete);
    });
}

test('the email field is one complete address with a browser-level email check', () => {
    const markup = renderToStaticMarkup(createElement(EmailField, {
        email: 'demo@taibu.local',
        onEmailChange: () => {},
    }));
    assert.match(markup, /type="email"/);
    assert.match(markup, /placeholder="name@example\.com"/);
    assert.match(markup, /autoComplete="email"/);
    assert.match(markup, /value="demo@taibu\.local"/);
    assert.match(markup, /required=""/);
    // The old prefix + suffix split is gone.
    assert.doesNotMatch(markup, /<select/);
    assert.doesNotMatch(markup, /@qq\.com/);
});

test('an address without a host is flagged only after the field is left', () => {
    // No blur in static markup: the hint must not show up while the user is still typing the first characters.
    const typing = renderToStaticMarkup(createElement(EmailField, {
        email: 'demo',
        onEmailChange: () => {},
    }));
    assert.doesNotMatch(typing, /auth-field-error/);
    assert.doesNotMatch(typing, /aria-invalid/);
});
