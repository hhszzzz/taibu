import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { mockAIFeatureState, mockAIRateLimit } from './helpers/route-mock';

test('face route rejects unsupported image mime types before auth', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t, async () => assert.fail('invalid image must not consume a rate slot'));
    const { POST } = await import('../app/api/face/route');

    const request = new NextRequest('http://localhost/api/face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'analyze',
            imageBase64: 'aGVsbG8=',
            imageMimeType: 'image/tiff',
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '图片格式不支持');
});

test('face route rejects missing image mime types before auth', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t, async () => assert.fail('invalid image must not consume a rate slot'));
    const { POST } = await import('../app/api/face/route');

    const request = new NextRequest('http://localhost/api/face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'analyze',
            imageBase64: 'aGVsbG8=',
            imageMimeType: null,
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '图片格式不支持');
});

test('palm route rejects unsupported image mime types before auth', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t, async () => assert.fail('invalid image must not consume a rate slot'));
    const { POST } = await import('../app/api/palm/route');

    const request = new NextRequest('http://localhost/api/palm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'analyze',
            imageBase64: 'aGVsbG8=',
            imageMimeType: 'image/tiff',
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '图片格式不支持');
});

test('palm route rejects missing image mime types before auth', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t, async () => assert.fail('invalid image must not consume a rate slot'));
    const { POST } = await import('../app/api/palm/route');

    const request = new NextRequest('http://localhost/api/palm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'analyze',
            imageBase64: 'aGVsbG8=',
            imageMimeType: null,
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '图片格式不支持');
});
