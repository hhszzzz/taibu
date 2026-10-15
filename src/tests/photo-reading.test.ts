import test from 'node:test';
import assert from 'node:assert/strict';

import { PHOTO_MAX_BYTES, fitPhotoSize, validatePhotoFile } from '../lib/divination/photo-reading';

test('photo validation rejects non-images and files over 10MB with user-facing copy', () => {
    assert.equal(validatePhotoFile({ type: 'image/jpeg', size: 2048 }), null);
    assert.equal(validatePhotoFile({ type: 'image/png', size: PHOTO_MAX_BYTES }), null);
    assert.equal(validatePhotoFile({ type: 'image/heic', size: PHOTO_MAX_BYTES + 1 }), '图片大小不能超过 10MB');
    assert.equal(validatePhotoFile({ type: 'application/pdf', size: 10 }), '请上传图片文件');
    assert.equal(validatePhotoFile({ type: '', size: 10 }), '请上传图片文件');
});

test('photo sizing keeps the aspect ratio, only shrinks, and never collapses to zero', () => {
    assert.deepEqual(fitPhotoSize(4032, 3024), { width: 1024, height: 768 });
    assert.deepEqual(fitPhotoSize(3024, 4032), { width: 768, height: 1024 });
    assert.deepEqual(fitPhotoSize(2048, 2048), { width: 1024, height: 1024 });
    assert.deepEqual(fitPhotoSize(800, 600), { width: 800, height: 600 });
    assert.deepEqual(fitPhotoSize(1024, 10), { width: 1024, height: 10 });
    assert.deepEqual(fitPhotoSize(5000, 2), { width: 1024, height: 1 });
    assert.deepEqual(fitPhotoSize(0, 0), { width: 1, height: 1 });
    assert.deepEqual(fitPhotoSize(600, 400, 300), { width: 300, height: 200 });
});
