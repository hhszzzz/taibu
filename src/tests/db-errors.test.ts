import assert from 'node:assert/strict';
import test from 'node:test';
import { DbError, isUniqueViolation, toDbError } from '../lib/db/errors';

test('toDbError preserves SQLSTATE, detail and hint', () => {
  const error = toDbError({ code: '23505', message: 'duplicate', detail: 'd', hint: 'h' });
  assert.ok(error instanceof DbError);
  assert.deepEqual({ code: error.code, message: error.message, details: error.details, hint: error.hint },
    { code: '23505', message: 'duplicate', details: 'd', hint: 'h' });
});

test('toDbError wraps unknown failures without losing the message', () => {
  assert.equal(toDbError(new Error('boom')).code, 'DB_ERROR');
  assert.equal(toDbError(new Error('boom')).message, 'boom');
  assert.equal(toDbError('plain').message, 'plain');
});

test('unique violations are detected through the wrapper', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation(new DbError({ code: '23503', message: 'fk' })), false);
});
