import test from 'node:test';
import assert from 'node:assert/strict';

import { avatarContentTypeForKey, sniffAvatarImage } from '../lib/storage/image-type';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = new TextEncoder().encode('GIF89a\x01\x00');
const WEBP = Uint8Array.from([
  ...new TextEncoder().encode('RIFF'),
  0x24, 0x00, 0x00, 0x00,
  ...new TextEncoder().encode('WEBPVP8 '),
]);
const AVIF = Uint8Array.from([
  0x00, 0x00, 0x00, 0x20,
  ...new TextEncoder().encode('ftypavif'),
]);

test('sniffAvatarImage recognizes the supported bitmap headers', () => {
  assert.deepEqual(sniffAvatarImage(PNG), { mime: 'image/png', extension: 'png' });
  assert.deepEqual(sniffAvatarImage(JPEG), { mime: 'image/jpeg', extension: 'jpg' });
  assert.deepEqual(sniffAvatarImage(GIF), { mime: 'image/gif', extension: 'gif' });
  assert.deepEqual(sniffAvatarImage(WEBP), { mime: 'image/webp', extension: 'webp' });
  assert.deepEqual(sniffAvatarImage(AVIF), { mime: 'image/avif', extension: 'avif' });
});

test('sniffAvatarImage rejects SVG, scripts and truncated data', () => {
  assert.equal(sniffAvatarImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffAvatarImage(new TextEncoder().encode('#!/bin/sh\nrm -rf /')), null);
  assert.equal(sniffAvatarImage(Uint8Array.from([0x89, 0x50])), null);
  assert.equal(sniffAvatarImage(new Uint8Array()), null);
  assert.equal(sniffAvatarImage(Uint8Array.from([0xff, 0xd8])), null);
});

test('avatarContentTypeForKey derives the response type from the key extension', () => {
  assert.equal(avatarContentTypeForKey('user-1-1700000000000.png'), 'image/png');
  assert.equal(avatarContentTypeForKey('user-1-1700000000000.jpeg'), 'image/jpeg');
  assert.equal(avatarContentTypeForKey('user-1-1700000000000.webp'), 'image/webp');
  assert.equal(avatarContentTypeForKey('user-1-1700000000000.svg'), null);
  assert.equal(avatarContentTypeForKey('user-1-1700000000000'), null);
});
