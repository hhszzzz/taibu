import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ICON_MOTIONS, playLucideMotion } from '../lib/motion/icon-hover';
import { SETTINGS_CENTER_TAB_ICONS } from '../components/settings/settings-center-icons';
import { AgentIcon, AstrologyIcon, TaiyiIcon } from '../lib/navigation/nav-icons';
import { NAV_REGISTRY } from '../lib/navigation/registry';

// 太乙、占星不在侧栏但 Agent 盘面卡片用它们；设置中心的图标有一半只在设置页出现。
const animatedIcons = [
  ...NAV_REGISTRY.map(item => item.icon),
  ...Object.values(SETTINGS_CENTER_TAB_ICONS),
  AgentIcon,
  TaiyiIcon,
  AstrologyIcon,
];

test('every navigation icon has a hover motion, and every part it moves is drawn', () => {
  for (const Icon of animatedIcons) {
    const markup = renderToStaticMarkup(createElement(Icon));
    const name = /data-nav-icon="([^"]+)"/u.exec(markup)?.[1];
    assert.ok(name, `${String((Icon as { displayName?: string }).displayName ?? Icon.name)} carries data-nav-icon`);
    const motions = ICON_MOTIONS[name];
    assert.ok(motions?.length, `${name} has a hover motion`);
    for (const { part } of motions) {
      // 改图时漏掉 ni-* 类名，动效会静默失效，所以逐个核对。
      assert.match(markup, new RegExp(`class="${part.slice(1)}"`, 'u'), `${name}: ${part} is drawn`);
    }
  }
});

test('rotations bake their pivot into the transform', () => {
  // Chromium 对 SVG `<g>` 不认 transform-box / transform-origin，原点会落到画布左上角；
  // 所以所有旋转、缩放都必须写成 translate(cx,cy) ... translate(-cx,-cy)。
  for (const [name, motions] of Object.entries(ICON_MOTIONS)) {
    for (const { part, keyframes } of motions) {
      const frames = typeof keyframes === 'function' ? [0, 1, 2].flatMap(keyframes) : keyframes;
      for (const frame of frames) {
        assert.equal(frame.transformBox, undefined, `${name} ${part}: 不写 transform-box`);
        assert.equal(frame.transformOrigin, undefined, `${name} ${part}: 不写 transform-origin`);
        if (typeof frame.transform === 'string' && /rotate|scale/u.test(frame.transform)) {
          assert.match(frame.transform, /^translate\(-?[\d.]+px, -?[\d.]+px\).+translate\(-?[\d.]+px, -?[\d.]+px\)$/u, `${name} ${part}: ${frame.transform}`);
        }
      }
    }
  }
});

test('every lucide icon gets a motion, named ones or the gentle fallback', () => {
  // lucide 组件把名字放进 svg 的类名（lucide-chevron-down 等），动效按类名查表。
  const played: string[] = [];
  const svg = (classes: string[]) => {
    const element = {
      classList: classes,
      animate: () => { played.push(classes.join(' ')); return { finished: Promise.resolve() }; },
    };
    return element as unknown as Element;
  };
  playLucideMotion(svg(['lucide', 'lucide-chevron-down']));
  playLucideMotion(svg(['lucide', 'lucide-some-unlisted-icon']));
  assert.deepEqual(played, ['lucide lucide-chevron-down', 'lucide lucide-some-unlisted-icon']);
});
