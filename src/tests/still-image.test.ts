import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readStillImage } from '../lib/images/still-image';
import { GENERATED_IMAGE_MAX_BYTES } from '../lib/images/generated';

const image = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({ create: { width, height, channels, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } });
const uint32 = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
const uint32le = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
const uint24le = (value: number) => Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
/** An extended WebP header for a 320×200 canvas with the given feature flags. */
const extendedWebp = (flags: number) => Buffer.concat([
  Buffer.from('RIFF'), uint32le(22), Buffer.from('WEBPVP8X'), uint32le(10), Buffer.from([flags, 0, 0, 0]), uint24le(319), uint24le(199),
]);

test('a still PNG, JPEG or WebP reads from its header with the size sharp decodes', async () => {
  const cases = [
    ['png', await image(320, 200).png().toBuffer(), 'image/png'],
    ['interlaced png', await image(320, 200).png({ progressive: true }).toBuffer(), 'image/png'],
    ['jpeg', await image(1024, 768).jpeg().toBuffer(), 'image/jpeg'],
    ['progressive jpeg with an orientation', await image(1536, 1024).jpeg({ progressive: true }).withMetadata({ orientation: 6 }).toBuffer(), 'image/jpeg'],
    ['lossy webp', await image(1792, 1024).webp().toBuffer(), 'image/webp'],
    ['lossless webp', await image(1024, 1792).webp({ lossless: true }).toBuffer(), 'image/webp'],
    ['webp with alpha', await image(640, 480, 4).webp().toBuffer(), 'image/webp'],
  ] as const;
  const webpChunks = new Set<string>();
  for (const [label, bytes, mediaType] of cases) {
    const { width, height } = await sharp(bytes).metadata();
    assert.deepEqual(readStillImage(new Uint8Array(bytes)), { mediaType, size: `${width}x${height}` }, label);
    if (mediaType === 'image/webp') webpChunks.add(bytes.subarray(12, 16).toString('latin1'));
  }
  assert.deepEqual([...webpChunks].sort(), ['VP8 ', 'VP8L', 'VP8X'], 'all three WebP headers are covered');
  assert.deepEqual(readStillImage(extendedWebp(0x10)), { mediaType: 'image/webp', size: '320x200' }, 'an alpha flag is fine');
});

test('animations, sizes the table cannot hold, cut-off files and other formats are refused', async () => {
  const png = await image(320, 200).png().toBuffer();
  const animationControl = Buffer.concat([uint32(8), Buffer.from('acTL'), uint32(2), uint32(0), uint32(0)]);
  assert.equal(readStillImage(Buffer.concat([png.subarray(0, 33), animationControl, png.subarray(33)])), null, 'animated PNG');
  assert.equal(readStillImage(extendedWebp(0x02)), null, 'animated WebP');

  assert.equal(readStillImage(await image(99, 200).png().toBuffer()), null, 'a side under 100 pixels');
  assert.equal(readStillImage(await image(10_000, 120).jpeg().toBuffer()), null, 'a side over 9999 pixels');

  const jpeg = await image(1024, 768).jpeg().toBuffer();
  assert.equal(readStillImage(png.subarray(0, 40)), null, 'a PNG cut off before its image data');
  assert.equal(readStillImage(jpeg.subarray(0, 12)), null, 'a JPEG cut off before its frame');
  assert.equal(readStillImage(extendedWebp(0).subarray(0, 24)), null, 'a WebP cut off inside its header');
  assert.equal(readStillImage(Buffer.from('GIF89a\x01\x00\x01\x00')), null);
  assert.equal(readStillImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(readStillImage(new Uint8Array()), null);
  assert.equal(readStillImage(new Uint8Array(GENERATED_IMAGE_MAX_BYTES + 1)), null, 'oversized images are rejected before header parsing');
});
