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

// 2024-01-01 为甲子日：00 甲子、04 丙寅、08 戊辰、12 庚午、16 壬申时；01-02 乙丑日、01-04 丁卯日、01-07 庚午日。
const boardOf = chart => chart.globalFormations.filter(value => value.startsWith('全盘: ')).map(value => value.slice(4));

test('Dunjia Yanyi human escape and the centre Bing hosted in Kun keep their classical palaces', async () => {
  // 原典: 阳遁七局，乙庚日丙子时，天任为直符加时干六丙于五宫（寄坤），生门直使加一宫，休门与丁奇临直符前二六宫太阴中，为人遁。
  const chart = await calculateQimen({ year: 2024, month: 1, day: 2, hour: 0, juNumber: 7, dunType: 'yang', zhiFuJiGong: 'ji_wugong' });
  assert.equal(chart.siZhu.hour, '丙子');
  assert.deepEqual(chart.zhiFu, { star: '天任星', palace: 2 });
  assert.deepEqual(chart.zhiShi, { gate: '生门', palace: 1 });
  assert.ok(chart.palaces[5].formations.includes('人遁'));
  // 中五地盘丙寄坤二：值符加时干丙即“甲加丙兮龙回首”
  assert.deepEqual(chart.palaces[1].hostedEarthStems, ['丙']);
  assert.ok(chart.palaces[1].formations.includes('青龙返首'));
  assert.ok(toQimenText(chart, { detailLevel: 'full' }).includes('| 壬、丙(寄) |'));
  // 天任八宫加坤二，九星整体对冲：只作一条全盘星反吟
  assert.deepEqual(boardOf(chart), ['星反吟']);
  assert.ok(!chart.globalFormations.some(value => /宫: 星反吟/u.test(value)));
});

test('a stem hosted with Tian Qin forms Xing Ge, tomb and punishment where it lands', async () => {
  // 原典: 阳遁三局，甲己日丙寅时，六庚在五宫寄二宫，直符天冲加时干六丙于一宫，天禽为六庚下临六己于四宫，为刑格。
  const xing = await calculateQimen({ year: 2024, month: 1, day: 1, hour: 4, juNumber: 3, dunType: 'yang', zhiFuJiGong: 'ji_wugong' });
  assert.equal(xing.siZhu.hour, '丙寅');
  assert.equal(xing.palaces[3].earthStem, '己');
  assert.deepEqual(xing.palaces[3].hostedHeavenStems, ['庚']);
  assert.ok(xing.palaces[3].formations.includes('刑格'));
  // 阳遁寄艮八时，寄干壬随天禽落巽四：壬墓在辰、甲辰壬刑在巽，主干丙均不成立
  const hosted = await calculateQimen({ ...birth, hour: 12, zhiFuJiGong: 'ji_liuyi' });
  assert.equal(hosted.palaces[3].heavenStem, '丙');
  assert.deepEqual(hosted.palaces[3].hostedHeavenStems, ['壬']);
  assert.equal(hosted.palaces[3].isRuMu, true);
  assert.equal(hosted.palaces[3].isJiXing, true);
});

test('Dunjia Yanyi Geng patterns, Qi De Shi, Jade Maiden and Wu Bu Yu on their source charts', async () => {
  // 原典: 阳遁九局，甲己日庚午时，天英直符加时干六庚于二宫为天乙飞宫格；六乙日奇下临三宫甲午为乙奇得使。
  const flying = await calculateQimen({ year: 2024, month: 1, day: 1, hour: 12, juNumber: 9, dunType: 'yang' });
  assert.equal(flying.siZhu.hour, '庚午');
  assert.equal(flying.palaces[1].heavenStem, '戊');
  assert.equal(flying.palaces[1].earthStem, '庚');
  assert.ok(flying.palaces[1].formations.includes('飞宫格'));
  // 甲子日干遁戊，戊加庚同为飞干格
  assert.ok(flying.palaces[1].formations.includes('飞干格'));
  assert.equal(flying.palaces[2].heavenStem, '乙');
  assert.equal(flying.palaces[2].earthStem, '辛');
  assert.ok(flying.palaces[2].formations.includes('三奇得使'));
  assert.ok(flying.palaces[2].formations.includes('青龙逃走'));
  // “甲子用庚午”：直使加地丁为玉女守门；甲日庚午时为五不遇时
  assert.ok(flying.palaces[5].formations.includes('玉女守门'));
  assert.deepEqual(boardOf(flying), ['五不遇时']);

  // 原典: 阳遁二局，甲己日壬申时，直符天芮加六宫，天辅为六庚下临直符于二宫，为天乙伏宫格。
  const hidden = await calculateQimen({ year: 2024, month: 1, day: 1, hour: 16, juNumber: 2, dunType: 'yang' });
  assert.equal(hidden.palaces[1].heavenStem, '庚');
  assert.equal(hidden.palaces[1].earthStem, '戊');
  assert.ok(hidden.palaces[1].formations.includes('伏宫格'));

  // 原典: 阳遁九局，乙庚日戊寅时，丁奇下临四宫甲辰为丁奇得使。
  const ding = await calculateQimen({ year: 2024, month: 1, day: 2, hour: 4, juNumber: 9, dunType: 'yang' });
  assert.equal(ding.siZhu.hour, '戊寅');
  assert.equal(ding.palaces[3].heavenStem, '丁');
  assert.equal(ding.palaces[3].earthStem, '壬');
  assert.ok(ding.palaces[3].formations.includes('三奇得使'));
});

test('stars and gates judge Fu Yin and Fan Yin separately and a whole-board condition is listed once', async () => {
  const cases = [
    // “凡六甲之时，门符皆是伏吟”
    [{ ...birth, hour: 0 }, ['星伏吟', '门伏吟']],
    [{ ...birth, hour: 0, panType: 'fei' }, ['星伏吟', '门伏吟']],
    // 时干即旬首六仪：值符不动而直使已移
    [{ ...birth, hour: 8 }, ['星伏吟']],
    // 阳九局丁未时：值符天辅由四宫加六宫
    [{ year: 2024, month: 1, day: 4, hour: 14, juNumber: 9, dunType: 'yang' }, ['星反吟']],
    // 阳一局壬申时：休门直使行八宫至离九
    [{ ...birth, hour: 16 }, ['门反吟']],
  ];
  for (const [input, expected] of cases) {
    const chart = await calculateQimen(input);
    assert.deepEqual(boardOf(chart).filter(name => /伏吟|反吟/u.test(name)), expected, chart.siZhu.hour);
    assert.ok(!chart.globalFormations.some(value => /宫: (?:星|门)(?:伏|反)吟/u.test(value)), chart.siZhu.hour);
    for (const name of expected) {
      assert.ok([0, 1, 2, 3, 5, 6, 7, 8].every(index => chart.palaces[index].formations.includes(name)), `${chart.siZhu.hour} ${name}`);
    }
  }
  // 阳九局寄坤逢甲时：坤二天地两盘同为本宫庚与中五癸，各自伏吟，不交叉成庚加癸大格
  const atHome = await calculateQimen({ ...birth, hour: 0, juNumber: 9, zhiFuJiGong: 'ji_wugong' });
  assert.deepEqual([atHome.palaces[1].heavenStem, ...atHome.palaces[1].hostedHeavenStems], ['庚', '癸']);
  assert.deepEqual([atHome.palaces[1].earthStem, ...atHome.palaces[1].hostedEarthStems], ['庚', '癸']);
  assert.ok(!atHome.palaces[1].formations.includes('大格'));
});

test('Wu Bu Yu follows hour-over-day control of the same polarity and the hour tomb list is explicit', async () => {
  // 庚日丙戌：时干丙阳火克日干庚阳金，且丙戌在“戊戌壬辰兼丙戌”之列
  const both = await calculateQimen({ ...birth, day: 7, hour: 20 });
  assert.equal(both.siZhu.hour, '丙戌');
  assert.deepEqual(boardOf(both).filter(name => !/伏吟|反吟/u.test(name)), ['五不遇时', '时干入墓']);
  // 乙日丁丑：丁不克乙，只为时干入墓
  const tomb = await calculateQimen({ ...birth, day: 2, hour: 2 });
  assert.equal(tomb.siZhu.hour, '丁丑');
  assert.deepEqual(boardOf(tomb).filter(name => !/伏吟|反吟/u.test(name)), ['时干入墓']);
  // 甲日乙丑：乙木与甲木同行不相克，不是五不遇时
  const none = await calculateQimen({ ...birth, hour: 2 });
  assert.equal(none.siZhu.hour, '乙丑');
  assert.ok(!boardOf(none).includes('五不遇时'));
  // 格局默认档也输出，全盘格局只列一次
  for (const detailLevel of ['default', 'full']) {
    assert.ok(toQimenJson(both, { detailLevel }).全局格局.includes('全盘: 五不遇时'));
    const text = toQimenText(both, { detailLevel });
    assert.match(text, /## 全局格局\n\n- 全盘: 五不遇时\n- 全盘: 时干入墓/u);
  }
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

test('乙 enters its tomb at 乾六 and is marked 五行墓 at 坤二', async () => {
  // 十二长生阳顺阴逆：乙木长生午、墓戌（乾六）为正墓；五行同墓之说木墓在未（坤二）
  const qian = await calculateQimen({ ...birth, hour: 14 });
  assert.equal(qian.palaces[5].heavenStem, '乙');
  assert.deepEqual(qian.palaces[5].ruMuStems, ['乙']);
  assert.equal(qian.palaces[5].isRuMu, true);
  const kun = await calculateQimen({ ...birth, hour: 4 });
  assert.equal(kun.palaces[1].heavenStem, '乙');
  assert.deepEqual(kun.palaces[1].ruMuStems, ['乙(五行墓)']);
  for (const detailLevel of ['default', 'full']) {
    assert.ok(toQimenJson(kun, { detailLevel }).九宫盘[1].宫位状态.includes('入墓(乙(五行墓))'));
    assert.ok(toQimenText(qian, { detailLevel }).split('\n').find(line => line.startsWith('| 乾6(')).includes('入墓(乙)'));
  }
  // 旧版结果没有 ruMuStems 时仍只写“入墓”
  const legacy = { ...kun, palaces: kun.palaces.map(palace => ({ ...palace, ruMuStems: undefined })) };
  assert.ok(toQimenJson(legacy).九宫盘[1].宫位状态.includes('入墓'));
});

test('驿马 follows the hour branch', async () => {
  // 甲子日丙寅时：寅午戌马在申（坤二），不取日支子的马星寅
  const chart = await calculateQimen({ ...birth, hour: 4 });
  assert.equal(chart.siZhu.day.charAt(1), '子');
  assert.equal(chart.siZhu.hour.charAt(1), '寅');
  assert.deepEqual(chart.yiMa, { branch: '申', palace: 2 });
  assert.deepEqual(chart.palaces.filter(palace => palace.isYiMa).map(palace => palace.palaceIndex), [2]);
});

test('the rotating board hosts the centre at 坤二 by default and 阳八阴二 on request', async () => {
  const defaults = await calculateQimen({ ...birth, hour: 12 });
  const kun = await calculateQimen({ ...birth, hour: 12, zhiFuJiGong: 'ji_wugong' });
  assert.deepEqual(defaults.palaces, kun.palaces);
  assert.equal(defaults.inputSnapshot.zhiFuJiGong, 'ji_wugong');
  // 中宫只留地盘干；中五地盘干作副干寄坤二，天禽随天芮同落
  const centre = defaults.palaces[4];
  assert.deepEqual([centre.star, centre.gate, centre.heavenStem], ['', '', '']);
  assert.ok(centre.earthStem);
  assert.deepEqual(defaults.palaces[1].hostedEarthStems, [centre.earthStem]);
  const rui = defaults.palaces.find(palace => palace.star === '天芮星');
  assert.deepEqual(rui.hostedStars, ['天禽星']);
  // 阳遁选 ji_liuyi 时寄艮八
  const gen = await calculateQimen({ ...birth, hour: 12, zhiFuJiGong: 'ji_liuyi' });
  assert.deepEqual(gen.palaces[7].hostedEarthStems, [centre.earthStem]);
  assert.equal(gen.palaces.find(palace => palace.star === '天任星').hostedStars?.[0], '天禽星');
});

test('the flying board judges Fu Yin star by star', async () => {
  // 阴遁一局甲子时、九星逆飞：天蓬留坎一自伏吟，其余八星未归本宫，不作全盘星伏吟；八门仍全盘伏吟
  const chart = await calculateQimen({ ...birth, dunType: 'yin', hour: 0, panType: 'fei' });
  assert.deepEqual(chart.palaces.filter(palace => palace.formations.includes('星伏吟')).map(palace => palace.palaceIndex), [1]);
  assert.ok(!chart.boardFormations.includes('星伏吟'));
  assert.ok(chart.globalFormations.includes('坎宫: 星伏吟'));
  assert.ok(chart.boardFormations.includes('门伏吟'));
});

test('六仪击刑 applies to every heaven-plate instrument, not only the chief', async () => {
  for (let hour = 0; hour < 24; hour += 2) {
    const chart = await calculateQimen({ ...birth, hour });
    const chief = chart.palaces.find(palace => palace.deity === '值符')?.heavenStem;
    const punished = chart.palaces.filter(palace => palace.isJiXing);
    if (punished.some(palace => palace.heavenStem !== chief)) return;
  }
  assert.fail('expected a non-chief instrument to be punished in one of the hours');
});
