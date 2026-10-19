import test from 'node:test';
import assert from 'node:assert/strict';
import { labelAngles } from '../components/visualization/AstrologyChart';

type Point = Parameters<typeof labelAngles>[0][number];
const point = (label: string, degree: number): Point => ({ id: label, label, factor: { 黄经度: degree } as Point['factor'] });
/** 1990-01-01 12:30 上海：摩羯座里 5 颗星挤在 10° 以内。 */
const POINTS = [point('天王星', 275.75), point('太阳', 280.48), point('海王星', 282.02), point('土星', 285.62), point('水星', 295.75),
  point('金星', 306.25), point('月亮', 329.07), point('上升', 28.22), point('木星', 95.18), point('冥王星', 227.08), point('火星', 249.77), point('天顶', 288.03)];
const RADIUS = 122;
const box = (label: string, degree: number) => {
  const theta = degree * Math.PI / 180;
  return { x: RADIUS * Math.sin(theta), y: -RADIUS * Math.cos(theta), w: label.length * 10, h: 12 };
};

test('wheel labels on one ring never overlap, even in a tight cluster', () => {
  const angles = labelAngles(POINTS);
  const boxes = POINTS.map(item => box(item.label, angles.get(item.id)!));
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const one = boxes[a], two = boxes[b];
    const overlap = Math.abs(one.x - two.x) < (one.w + two.w) / 2 - 1 && Math.abs(one.y - two.y) < (one.h + two.h) / 2 - 1;
    assert.ok(!overlap, `${POINTS[a].label} and ${POINTS[b].label} overlap`);
  }
});

test('a lone label stays at its body, and a pushed label stays close to it', () => {
  const angles = labelAngles(POINTS);
  assert.equal(angles.get('木星'), 95.18);
  for (const item of POINTS) {
    const shift = Math.abs(((angles.get(item.id)! - item.factor.黄经度! + 540) % 360) - 180);
    assert.ok(shift < 30, `${item.label} moved ${shift.toFixed(1)}°`);
  }
});

test('labels across 0° are spread as one group', () => {
  const angles = labelAngles([point('甲', 358), point('乙', 1), point('丙', 3)]);
  const order = ['甲', '乙', '丙'].map(id => (angles.get(id)! + 180) % 360);
  assert.ok(order[0] < order[1] && order[1] < order[2], 'the order around 0° is kept');
});
