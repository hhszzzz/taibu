import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCompletedCode } from '../lib/auth/otp-completion';

test('a full code is reported once even when the submit callback changes identity', () => {
    assert.equal(nextCompletedCode(null, '12345', 6), null);
    assert.equal(nextCompletedCode(null, '123456', 6), '123456');
    // Same code, new render: nothing to submit -> a wrong code cannot be sent twice in a row.
    assert.equal(nextCompletedCode('123456', '123456', 6), null);
    assert.equal(nextCompletedCode('123456', '123456', 6), null);
});

test('editing a digit produces a new code that is reported again', () => {
    assert.equal(nextCompletedCode('123456', '123457', 6), '123457');
    assert.equal(nextCompletedCode('123456', '12345', 6), null);
    assert.equal(nextCompletedCode(null, '123457', 6), '123457');
});

test('the retry after a failed verification can be the same six digits typed again', () => {
    // Backspace once clears the record, so re-entering the same code is an explicit retry.
    assert.equal(nextCompletedCode('123456', '12345', 6), null);
    assert.equal(nextCompletedCode(null, '123456', 6), '123456');
});
