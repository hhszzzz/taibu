import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { calculateQimen, toQimenJson, toQimenText } from 'taibu-core';

const birth = { year: 2024, month: 1, day: 1, hour: 3, juNumber: 1, dunType: 'yang' };

test('flying center displays its own MenPo status while rotating center retains hosting', async () => {
  const flying = await calculateQimen({ ...birth, panType: 'fei' });
  assert.equal(flying.palaces[4].gate, '伤门');
  assert.equal(flying.palaces[4].isMenPo, true);
  const rotating = await calculateQimen({ ...birth, panType: 'zhuan' });
  for (const detailLevel of ['default', 'full']) {
    assert.ok(toQimenJson(flying, { detailLevel }).九宫盘[4].宫位状态.includes('门迫'));
    const centerRow = toQimenText(flying, { detailLevel }).split('\n').find(line => line.startsWith('| 中5('));
    assert.match(centerRow, /门迫/u);
    assert.doesNotMatch(centerRow, /寄宫参看/u);
    assert.deepEqual(toQimenJson(rotating, { detailLevel }).九宫盘[4].宫位状态, ['寄宫参看对应宫位']);
  }
});

test('Qimen retains directional Geng-over-Gui DaGe in palace and canonical formations', async () => {
  // 《烟波钓叟歌》“庚加癸兮为大格”；《遁甲演义·大隔》明确天庚、地癸。
  const chart = await calculateQimen({ ...birth, hour: 9 });
  const palace = chart.palaces.find(value => value.heavenStem === '庚' && value.earthStem === '癸');
  assert.ok(palace);
  assert.ok(palace.formations.includes('大格'));
  assert.ok(chart.globalFormations.includes(`${palace.palaceName}宫: 大格`));
  assert.ok(toQimenJson(chart, { detailLevel: 'full' }).九宫盘[palace.palaceIndex - 1].格局.includes('大格'));
});

test('rotating late Zi uses the displayed next-day pillars without depending on civil DST gaps', async () => {
  const layers = chart => chart.palaces.map(palace => ({ earth: palace.earthStem, heaven: palace.heavenStem,
    stars: [palace.star, ...(palace.hostedStars ?? [])], gate: palace.gate, deity: palace.deity }));
  for (const timezone of ['Asia/Shanghai', 'America/New_York', 'Australia/Lord_Howe', 'Pacific/Apia']) {
    const midnight = await calculateQimen({ ...birth, day: 2, hour: 0, timezone });
    for (const minute of [0, 59]) {
      const late = await calculateQimen({ ...birth, hour: 23, minute, timezone });
      assert.equal(late.siZhu.day, midnight.siZhu.day);
      assert.equal(late.siZhu.hour, midnight.siZhu.hour);
      assert.deepEqual(layers(late), layers(midnight), `${timezone} 23:${minute}`);
      assert.deepEqual(late.zhiFu, midnight.zhiFu);
      assert.deepEqual(late.zhiShi, midnight.zhiShi);
    }
  }
  for (const [year, month, day, timezone] of [[2018, 11, 3, 'America/Sao_Paulo'], [2011, 12, 29, 'Pacific/Apia']]) {
    const late = await calculateQimen({ ...birth, year, month, day, hour: 23, minute: 30, timezone });
    const civilReference = await calculateQimen({ ...birth, year, month, day: day + 1, hour: 0, timezone: 'Etc/GMT-8' });
    assert.equal(late.siZhu.hour, civilReference.siZhu.hour);
    assert.deepEqual(layers(late), layers(civilReference), timezone);
  }
});

test('rotating board is identical where process.env.TZ cannot be overridden, as in browsers', async () => {
  const inputs = [{ ...birth, hour: 12, juNumber: 9 }, { ...birth, hour: 23, minute: 30 }];
  const layers = chart => chart.palaces.map(palace => [palace.heavenStem, palace.earthStem, palace.star, palace.gate, palace.deity]);
  const expected = await Promise.all(inputs.map(async input => layers(await calculateQimen(input))));
  // 浏览器里写 process.env.TZ 不改变本地时区：子进程拦截对 TZ 的写入来模拟
  const script = `
    process.env = new Proxy(process.env, {
      set(target, key, value) { if (key !== 'TZ') target[key] = value; return true; },
      deleteProperty(target, key) { if (key !== 'TZ') delete target[key]; return true; },
    });
    const { calculateQimen } = await import('taibu-core');
    const charts = [];
    for (const input of ${JSON.stringify(inputs)}) charts.push(await calculateQimen(input));
    console.log(JSON.stringify(charts.map(chart => chart.palaces.map(palace => [palace.heavenStem, palace.earthStem, palace.star, palace.gate, palace.deity]))));
  `;
  for (const timeZone of ['America/New_York', 'Pacific/Kiritimati', 'UTC']) {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, TZ: timeZone }, encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(output.trim()), expected, timeZone);
  }
});

test('manual yang-one flying board follows the Lo-Shu instruments, chief star and gate', async () => {
  const chart = await calculateQimen({ ...birth, panType: 'fei' });
  assert.equal(chart.siZhu.hour, '丙寅');
  assert.deepEqual(chart.palaces.map(p => p.earthStem), ['戊', '己', '庚', '辛', '壬', '癸', '丁', '丙', '乙']);
  assert.deepEqual(chart.palaces.map(p => p.star), ['天冲星', '天辅星', '天禽星', '天心星', '天柱星', '天任星', '天英星', '天蓬星', '天芮星']);
  assert.deepEqual(chart.zhiFu, { star: '天蓬星', palace: 8 });
  assert.deepEqual(chart.zhiShi, { gate: '休门', palace: 3 });
  assert.equal(chart.palaces[2].gate, '休门');
  assert.equal(chart.palaces.filter(p => p.gate).length, 8);
});

test('rotating chief gate reports its destination rather than its home palace', async () => {
  const chart = await calculateQimen(birth);
  assert.deepEqual(chart.zhiShi, { gate: '休门', palace: 3 });
  assert.equal(chart.palaces[chart.zhiShi.palace - 1].gate, chart.zhiShi.gate);
});

test('Dunjia Yanyi independent symbolic sky/earth escape examples retain all prerequisites', async () => {
  // 原典: 阳遁四局，乙庚日乙酉时，生门/丙奇/地丁在坎一为天遁。
  const sky = await calculateQimen({ year: 2026, month: 1, day: 1, hour: 18, juNumber: 4, dunType: 'yang' });
  assert.equal(sky.siZhu.hour, '乙酉');
  assert.equal(sky.palaces[0].heavenStem, '丙');
  assert.equal(sky.palaces[0].earthStem, '丁');
  assert.equal(sky.palaces[0].gate, '生门');
  assert.ok(sky.palaces[0].formations.includes('天遁'));
  // 原典: 阳遁一局，丙辛日辛卯时，开门/乙奇/地己在坤二为地遁。
  const earth = await calculateQimen({ year: 2026, month: 1, day: 7, hour: 6, juNumber: 1, dunType: 'yang' });
  assert.equal(earth.siZhu.hour, '辛卯');
  assert.equal(earth.palaces[1].heavenStem, '乙');
  assert.equal(earth.palaces[1].earthStem, '己');
  assert.equal(earth.palaces[1].gate, '开门');
  assert.ok(earth.palaces[1].formations.includes('地遁'));
});

test('Maoshan remains yang after winter solstice across the Gregorian year boundary', async () => {
  const chart = await calculateQimen({ year: 2026, month: 1, day: 1, hour: 0, juMethod: 'maoshan' });
  assert.equal(chart.dateInfo.solarTerm, '冬至');
  assert.equal(chart.dunType, 'yang');
  assert.equal(chart.yuan, '下元');
  assert.equal(chart.juNumber, 4);
});

test('both flying profiles preserve nine unique stars and instruments over every bureau and hour stem', async () => {
  for (const dunType of ['yang', 'yin']) for (let juNumber = 1; juNumber <= 9; juNumber++) for (const flyStarMethod of ['forward', 'yin-reverse']) {
    for (let hour = 0; hour < 24; hour++) {
      const chart = await calculateQimen({ ...birth, hour, panType: 'fei', juNumber, dunType, flyStarMethod });
      assert.equal(new Set(chart.palaces.map(p => p.star)).size, 9);
      assert.equal(new Set(chart.palaces.map(p => p.earthStem)).size, 9);
      assert.equal(new Set(chart.palaces.map(p => p.heavenStem)).size, 9);
      assert.equal(new Set(chart.palaces.map(p => p.deity)).size, 9);
      assert.equal(chart.palaces.filter(p => p.gate).length, 8);
      assert.equal(chart.palaces[chart.zhiFu.palace - 1].star, chart.zhiFu.star);
      for (const palace of chart.palaces) {
        assert.equal(palace.formations.includes('大格'), palace.heavenStem === '庚' && palace.earthStem === '癸');
      }
    }
  }
});

test('invalid dates and unimplemented profiles never silently produce another chart', () => {
  for (const patch of [{ month: 2, day: 31 }, { hour: 24 }, { minute: 60 }, { panType: 'invalid' }, { juMethod: 'zhirun' }]) {
    assert.throws(() => calculateQimen({ ...birth, ...patch }));
  }
});
