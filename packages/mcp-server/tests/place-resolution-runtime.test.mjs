import test from 'node:test';
import assert from 'node:assert/strict';

import { buildListToolsPayload, executeTool } from 'taibu-core/mcp';

test('mcp server runtime place resolution should geocode city-level birthPlace when longitude is absent', async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.AMAP_WEB_SERVICE_KEY;
  process.env.AMAP_WEB_SERVICE_KEY = 'test-amap-key';

  global.fetch = async () => new Response(JSON.stringify({
    status: '1',
    geocodes: [
      {
        formatted_address: '广东省河源市',
        location: '114.700215,23.744276',
        adcode: '441600',
        level: '市',
      },
    ],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.AMAP_WEB_SERVICE_KEY;
    } else {
      process.env.AMAP_WEB_SERVICE_KEY = originalKey;
    }
  });

  const { preprocessToolArgsForRuntimePlace } = await import('../dist/place-resolution.js');
  const result = await preprocessToolArgsForRuntimePlace('ziwei', {
    gender: 'male',
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 12,
    birthPlace: '广东河源',
  });

  assert.equal(result.toolArgs.longitude, 114.700215);
  assert.equal(result.placeResolutionInfo?.source, 'birth_place');
  assert.equal(result.placeResolutionInfo?.locationMode, 'true_solar_time');
  assert.equal(result.placeResolutionInfo?.level, '市');
});

test('mcp server runtime place resolution should normalize manual string longitude and skip geocoding', async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.AMAP_WEB_SERVICE_KEY;
  process.env.AMAP_WEB_SERVICE_KEY = 'test-amap-key';

  global.fetch = async () => {
    throw new Error('fetch should not be called when longitude already exists');
  };

  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.AMAP_WEB_SERVICE_KEY;
    } else {
      process.env.AMAP_WEB_SERVICE_KEY = originalKey;
    }
  });

  const { preprocessToolArgsForRuntimePlace } = await import('../dist/place-resolution.js');
  const result = await preprocessToolArgsForRuntimePlace('bazi', {
    gender: 'male',
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 12,
    birthPlace: '广东河源',
    longitude: '114.7',
  });

  assert.equal(result.toolArgs.longitude, 114.7);
  assert.equal(result.placeResolutionInfo?.source, 'manual_input');
  assert.equal(result.placeResolutionInfo?.locationMode, 'true_solar_time');
  await assert.doesNotReject(() => executeTool('bazi', result.toolArgs));
});

test('mcp server runtime place resolution should degrade on province-level geocode precision', async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.AMAP_WEB_SERVICE_KEY;
  process.env.AMAP_WEB_SERVICE_KEY = 'test-amap-key';

  global.fetch = async () => new Response(JSON.stringify({
    status: '1',
    geocodes: [
      {
        formatted_address: '广东省',
        location: '113.266887,23.133306',
        adcode: '440000',
        level: '省',
      },
    ],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.AMAP_WEB_SERVICE_KEY;
    } else {
      process.env.AMAP_WEB_SERVICE_KEY = originalKey;
    }
  });

  const { preprocessToolArgsForRuntimePlace } = await import('../dist/place-resolution.js');
  const result = await preprocessToolArgsForRuntimePlace('ziwei_horoscope', {
    gender: 'male',
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 12,
    birthPlace: '广东省',
  });

  assert.equal(result.toolArgs.longitude, undefined);
  assert.equal(result.placeResolutionInfo?.source, 'fallback');
  assert.equal(result.placeResolutionInfo?.fallbackReason, 'precision_too_low');
  assert.equal(result.placeResolutionInfo?.locationMode, 'true_solar_time');
});

test('mcp server tool payload should advertise runtime birthPlace resolution without changing core itself', async () => {
  const { decorateToolListPayloadForRuntime } = await import('../dist/place-resolution.js');

  const corePayload = buildListToolsPayload();
  const ziweiCore = corePayload.tools.find((tool) => tool.name === 'ziwei');
  const astrologyCore = corePayload.tools.find((tool) => tool.name === 'astrology');
  assert.equal(typeof ziweiCore?.inputSchema?.properties?.birthPlace, 'undefined');
  assert.deepEqual(astrologyCore?.inputSchema?.required, ['birthYear', 'birthMonth', 'birthDay', 'birthHour']);
  assert.equal(Array.isArray(astrologyCore?.inputSchema?.allOf), true);

  const decorated = decorateToolListPayloadForRuntime(corePayload);
  const ziweiTool = decorated.tools.find((tool) => tool.name === 'ziwei');
  const baziTool = decorated.tools.find((tool) => tool.name === 'bazi');
  const astrologyTool = decorated.tools.find((tool) => tool.name === 'astrology');

  assert.equal(typeof ziweiTool?.inputSchema?.properties?.birthPlace, 'object');
  assert.equal(typeof ziweiTool?.outputSchema?.properties?.placeResolutionInfo, 'object');
  assert.equal(typeof baziTool?.inputSchema?.properties?.birthPlace, 'object');
  assert.equal(typeof baziTool?.outputSchema?.properties?.placeResolutionInfo, 'object');
  assert.equal(typeof astrologyTool?.inputSchema?.properties?.birthPlace, 'object');
  assert.equal(typeof astrologyTool?.outputSchema?.properties?.placeResolutionInfo, 'object');
  assert.equal(astrologyTool?.inputSchema?.properties?.birthPlace?.description, '出生地点文本');
  assert.equal(astrologyTool?.description, astrologyCore?.description);
  assert.deepEqual(astrologyTool?.inputSchema?.required, ['birthYear', 'birthMonth', 'birthDay', 'birthHour']);
  assert.equal(Array.isArray(astrologyTool?.inputSchema?.allOf), true);
  assert.equal(astrologyTool?.inputSchema?.allOf?.length, astrologyCore?.inputSchema?.allOf?.length);
  assert.deepEqual(astrologyTool?.inputSchema?.allOf?.[0], astrologyCore?.inputSchema?.allOf?.[0]);
  assert.deepEqual(astrologyTool?.inputSchema?.allOf?.[1], astrologyCore?.inputSchema?.allOf?.[1]);
  const fullRule = astrologyTool?.inputSchema?.allOf?.find((branch) => Array.isArray(branch?.then?.anyOf));
  assert.equal(Array.isArray(fullRule?.then?.anyOf), true);
  assert.deepEqual(fullRule?.then?.anyOf?.map((branch) => branch.required), [
    ['latitude', 'longitude'],
    ['birthPlace'],
  ]);
  assert.equal(typeof astrologyTool?.outputSchema?.properties?.placeResolutionInfo?.properties?.locationMode, 'object');
  assert.deepEqual(
    astrologyTool?.outputSchema?.properties?.placeResolutionInfo?.properties?.source?.enum,
    ['manual_input', 'birth_place', 'fallback'],
  );
  assert.deepEqual(
    astrologyTool?.outputSchema?.properties?.placeResolutionInfo?.properties?.fallbackReason?.enum,
    ['no_birth_place', 'geocoder_disabled', 'geocode_failed', 'precision_too_low', 'invalid_location'],
  );
  assert.deepEqual(
    astrologyTool?.outputSchema?.properties?.placeResolutionInfo?.properties?.locationMode?.enum,
    ['coordinates', 'true_solar_time'],
  );
  assert.equal(typeof astrologyTool?.outputSchema?.properties?.placeResolutionInfo?.properties?.trueSolarTimeApplied, 'undefined');
});

test('mcp server runtime place resolution should geocode astrology birthPlace into longitude and latitude', async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.AMAP_WEB_SERVICE_KEY;
  process.env.AMAP_WEB_SERVICE_KEY = 'test-amap-key';

  global.fetch = async () => new Response(JSON.stringify({
    status: '1',
    geocodes: [
      {
        formatted_address: '美国纽约州纽约市',
        location: '-74.006000,40.712800',
        adcode: '000000',
        level: '市',
      },
    ],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.AMAP_WEB_SERVICE_KEY;
    } else {
      process.env.AMAP_WEB_SERVICE_KEY = originalKey;
    }
  });

  const { preprocessToolArgsForRuntimePlace } = await import('../dist/place-resolution.js');
  const result = await preprocessToolArgsForRuntimePlace('astrology', {
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 12,
    birthMinute: 30,
    birthPlace: 'New York, NY',
  });

  assert.equal(result.toolArgs.longitude, -74.006);
  assert.equal(result.toolArgs.latitude, 40.7128);
  assert.equal(result.placeResolutionInfo?.usedLongitude, -74.006);
  assert.equal(result.placeResolutionInfo?.usedLatitude, 40.7128);
  assert.equal(result.placeResolutionInfo?.source, 'birth_place');
  assert.equal(result.placeResolutionInfo?.locationMode, 'coordinates');
});

test('mcp server runtime place resolution should normalize explicit astrology string coordinates and skip geocoding', async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.AMAP_WEB_SERVICE_KEY;
  process.env.AMAP_WEB_SERVICE_KEY = 'test-amap-key';

  global.fetch = async () => {
    throw new Error('fetch should not be called when coordinates already exist');
  };

  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.AMAP_WEB_SERVICE_KEY;
    } else {
      process.env.AMAP_WEB_SERVICE_KEY = originalKey;
    }
  });

  const { preprocessToolArgsForRuntimePlace } = await import('../dist/place-resolution.js');
  const result = await preprocessToolArgsForRuntimePlace('astrology', {
    birthYear: 1990,
    birthMonth: 1,
    birthDay: 1,
    birthHour: 12,
    latitude: '40.7128',
    longitude: '-74.006',
    birthPlace: 'New York, NY',
  });

  assert.equal(result.toolArgs.longitude, -74.006);
  assert.equal(result.toolArgs.latitude, 40.7128);
  assert.equal(result.placeResolutionInfo?.source, 'manual_input');
  assert.equal(result.placeResolutionInfo?.usedLatitude, 40.7128);
  assert.equal(result.placeResolutionInfo?.locationMode, 'coordinates');
  await assert.doesNotReject(() => executeTool('astrology', result.toolArgs));
});

test('mcp server runtime place resolution should preserve invalid non-object args for core validation', async () => {
  const { preprocessToolArgsForRuntimePlace } = await import('../dist/place-resolution.js');
  const result = await preprocessToolArgsForRuntimePlace('ziwei', null);

  assert.equal(result.toolArgs, null);
  assert.equal(result.placeResolutionInfo, undefined);
});

test('mcp server markdown place-resolution note should stay neutral and avoid runtime strategy wording', async () => {
  const { attachPlaceResolutionNoteToPayload } = await import('../dist/place-resolution.js');
  const payload = { content: [{ type: 'text', text: '# test' }] };

  const astrologyPayload = attachPlaceResolutionNoteToPayload(payload, {
    requestedPlace: 'New York, NY',
    resolved: false,
    source: 'fallback',
    fallbackReason: 'geocode_failed',
    locationMode: 'coordinates',
  }, 'markdown');

  const astrologyText = astrologyPayload.content[0].text;
  assert.match(astrologyText, /出生地解析/u);
  assert.match(astrologyText, /原因/u);
  assert.doesNotMatch(astrologyText, /近似盘/u);
  assert.doesNotMatch(astrologyText, /真太阳时/u);

  const ziweiPayload = attachPlaceResolutionNoteToPayload(payload, {
    requestedPlace: '广东河源',
    resolved: false,
    source: 'fallback',
    fallbackReason: 'geocode_failed',
    locationMode: 'true_solar_time',
  }, 'markdown');

  assert.match(ziweiPayload.content[0].text, /出生地解析/u);
  assert.doesNotMatch(ziweiPayload.content[0].text, /真太阳时/u);
});

test('place text stays a single literal Markdown value', async () => {
  const { attachPlaceResolutionNoteToPayload } = await import('../dist/place-resolution.js');
  const result = attachPlaceResolutionNoteToPayload({ content: [{ type: 'text', text: '# chart' }] }, {
    requestedPlace: '北京\n## injected [link](https://example.com)', formattedAddress: '<b>地址</b>',
    resolved: true, source: 'birth_place', locationMode: 'coordinates',
  }, 'markdown');
  const text = result.content[0].text;
  assert.ok(text.includes('北京 \\#\\# injected \\[link\\]\\(https://example\\.com\\)'));
  assert.ok(text.includes('\\<b\\>地址\\</b\\>'));
  assert.equal(text.split('\n').filter(line => /^## /u.test(line)).length, 1);
});
