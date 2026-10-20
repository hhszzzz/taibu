/**
 * 占星单点详查：一颗星体（或交点、轴点）或一个宫位的位置、传统尊贵、宫主星、
 * 本命相位（入相／出相）与流运触发。只陈述盘面事实，不下吉凶结论。
 * focus 可只看本命或只看流运；只看流运时仍给出所查对象在本命盘上的位置作为参照。
 */

import { Body, Ecliptic, GeoVector } from 'astronomy-engine';
import { CoreInputError, assertInteger, resolveEnum } from '../../shared/validation.js';
import { ANGLE_KEYS, ASPECT_ANGLES, BODY_KEYS, POINT_KEYS, SIGN_LABELS, computeAngularDistance } from './calculate.js';
import type { AstrologyAspect, AstrologyFactor, AstrologyHouse, AstrologyInput, AstrologyOutput } from './types.js';

export const ASTROLOGY_POINT_RULE_VERSION = 'astrology-point-2026.10';
export const ASTROLOGY_POINT_KEYS = [...BODY_KEYS, ...POINT_KEYS, ...ANGLE_KEYS] as const;
export type AstrologyPointKey = typeof ASTROLOGY_POINT_KEYS[number];

/** 全部=本命与流运；本命=不看流运；流运=只看流运触发或过境（附本命位置作参照） */
export const ASTROLOGY_POINT_FOCUS = ['全部', '本命', '流运'] as const;
export type AstrologyPointFocus = typeof ASTROLOGY_POINT_FOCUS[number];

export interface AstrologyPointSelector {
  planet?: AstrologyPointKey;
  house?: number;
  focus?: AstrologyPointFocus;
}

export interface AstrologyPointRef {
  chart: '本命' | '流运';
  key: string;
  label: string;
}

export interface AstrologyPointAspect {
  type: string;
  from: AstrologyPointRef;
  to: AstrologyPointRef;
  orb: number;
  angle: number;
  /** 两端都能算出运动速度时才给出 */
  phase?: '入相' | '出相';
}

export interface AstrologyPointPlacement {
  ref: AstrologyPointRef;
  sign: string;
  element: string;
  modality: string;
  position: string;
  house?: number;
  retrograde?: boolean;
}

export type AstrologyDignity = '入庙' | '擢升' | '失势' | '落陷';

export interface AstrologyPointOutput {
  query: ({ kind: 'planet'; key: AstrologyPointKey; label: string } | { kind: 'house'; house: number; label: string }) & { focus: AstrologyPointFocus };
  placement?: AstrologyPointPlacement;
  /** 只对七颗传统行星给出；现代行星、交点与轴点为 undefined */
  dignities?: AstrologyDignity[];
  /** 该行星按传统守护所主管的宫位 */
  ruledHouses?: number[];
  house?: { id: number; sign: string; start: string; end: string; span: number };
  occupants?: AstrologyPointPlacement[];
  ruler?: AstrologyPointPlacement & { dignities: AstrologyDignity[] };
  /** 星体本身（或宫主星）的本命相位；只看流运时省略 */
  aspects?: AstrologyPointAspect[];
  /** 流运对该星体的相位；只看本命或查宫位时省略 */
  transitAspects?: AstrologyPointAspect[];
  /** 流运时刻落在该宫的星体；只看本命时省略 */
  transitOccupants?: AstrologyPointPlacement[];
  calculationOptions: Record<string, unknown> & { ruleVersion: string };
}

const SIGN_KEYS = Object.keys(SIGN_LABELS);

/** 托勒密传统守护（不含现代行星守护） */
const DOMICILE_RULER: Record<string, string> = {
  aries: 'mars', taurus: 'venus', gemini: 'mercury', cancer: 'moon', leo: 'sun', virgo: 'mercury',
  libra: 'venus', scorpio: 'mars', sagittarius: 'jupiter', capricorn: 'saturn', aquarius: 'saturn', pisces: 'jupiter',
};
const EXALTATION: Record<string, string> = {
  sun: 'aries', moon: 'taurus', mercury: 'virgo', venus: 'pisces', mars: 'capricorn', jupiter: 'cancer', saturn: 'libra',
};
const TRADITIONAL_PLANETS = new Set(['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn']);

const MOTION_BODIES: Record<string, Body> = {
  sun: Body.Sun, moon: Body.Moon, mercury: Body.Mercury, venus: Body.Venus, mars: Body.Mars,
  jupiter: Body.Jupiter, saturn: Body.Saturn, uranus: Body.Uranus, neptune: Body.Neptune, pluto: Body.Pluto,
};

const opposite = (sign: string) => SIGN_KEYS[(SIGN_KEYS.indexOf(sign) + 6) % 12];

export function traditionalDignities(planet: string, sign: string): AstrologyDignity[] {
  if (!TRADITIONAL_PLANETS.has(planet) || !SIGN_KEYS.includes(sign)) return [];
  const states: AstrologyDignity[] = [];
  if (DOMICILE_RULER[sign] === planet) states.push('入庙');
  if (EXALTATION[planet] === sign) states.push('擢升');
  if (DOMICILE_RULER[opposite(sign)] === planet) states.push('失势');
  if (EXALTATION[planet] && opposite(EXALTATION[planet]) === sign) states.push('落陷');
  return states;
}

/** 一小时内的黄经变化（度，带符号）；交点、莉莉丝与轴点不计速度 */
function hourlyMotion(key: string, instant: string | undefined): number | undefined {
  const body = MOTION_BODIES[key];
  if (!body || !instant) return undefined;
  const at = new Date(instant);
  if (!Number.isFinite(at.getTime())) return undefined;
  const longitude = (date: Date) => Ecliptic(GeoVector(body, date, true)).elon;
  return ((longitude(new Date(at.getTime() + 3600000)) - longitude(at) + 540) % 360) - 180;
}

function placementOf(factor: AstrologyFactor, chart: AstrologyPointRef['chart'], isApproximate: boolean): AstrologyPointPlacement {
  return {
    ref: { chart, key: factor.key, label: factor.label },
    sign: factor.sign.label,
    element: factor.sign.element,
    modality: factor.sign.modality,
    position: `${factor.position.absolute} / ${factor.position.withinSign}`,
    ...(!isApproximate && typeof factor.house === 'number' ? { house: factor.house } : {}),
    ...(typeof factor.retrograde === 'boolean' ? { retrograde: factor.retrograde } : {}),
  };
}

function inHouse(decimal: number, house: AstrologyHouse): boolean {
  return ((decimal - house.start.decimal + 360) % 360) < ((house.end.decimal - house.start.decimal + 360) % 360);
}

export function deriveAstrologyPoint(
  chart: AstrologyOutput,
  selector: AstrologyPointSelector,
  _baseInput: AstrologyInput,
): AstrologyPointOutput {
  const hasPlanet = selector.planet !== undefined, hasHouse = selector.house !== undefined;
  if (hasPlanet === hasHouse) throw new CoreInputError(hasPlanet ? 'house' : 'planet', 'planet 与 house 必须且只能给出一个');
  const focus = resolveEnum(selector.focus, ASTROLOGY_POINT_FOCUS, '全部', 'focus');
  const natalPart = focus !== '流运', transitPart = focus !== '本命';
  const isApproximate = chart.chartMeta.calculationMode === 'approximate';
  const natalFactors = [...chart.natal.bodies, ...chart.natal.points, ...chart.natal.angles];
  const natalByKey = new Map(natalFactors.map((factor) => [factor.key, factor]));
  const transitByKey = new Map([...chart.transit.bodies, ...chart.transit.points].map((factor) => [factor.key, factor]));
  const instants = { 本命: chart.natal.origin.utcDateTime, 流运: chart.transit.origin.utcDateTime };

  const aspectRow = (aspect: AstrologyAspect, fromChart: AstrologyPointRef['chart']): AstrologyPointAspect => {
    const from = (fromChart === '流运' ? transitByKey : natalByKey).get(aspect.from.key);
    const to = natalByKey.get(aspect.to.key);
    let phase: AstrologyPointAspect['phase'];
    const fromMotion = hourlyMotion(aspect.from.key, instants[fromChart]);
    // 流运对本命时本命端固定不动
    const toMotion = fromChart === '流运' ? 0 : hourlyMotion(aspect.to.key, instants.本命);
    if (from && to && fromMotion !== undefined && toMotion !== undefined) {
      const next = Math.abs(computeAngularDistance(from.position.decimal + fromMotion, to.position.decimal + toMotion) - ASPECT_ANGLES[aspect.type].angle);
      phase = next < aspect.orb ? '入相' : '出相';
    }
    return {
      type: aspect.label,
      from: { chart: fromChart, key: aspect.from.key, label: aspect.from.label },
      to: { chart: '本命', key: aspect.to.key, label: aspect.to.label },
      orb: Number(aspect.orb.toFixed(4)),
      angle: Number(aspect.actualAngle.toFixed(4)),
      ...(phase ? { phase } : {}),
    };
  };
  const natalAspectsOf = (key: string) => chart.majorAspects
    .filter((aspect) => aspect.from.key === key || aspect.to.key === key)
    .map((aspect) => aspectRow(aspect, '本命'));
  const calculationOptions = {
    zodiac: chart.chartMeta.zodiac,
    houseSystem: chart.chartMeta.houseSystem,
    ...(chart.chartMeta.ephemeris ? { ephemeris: chart.chartMeta.ephemeris } : {}),
    ...(chart.chartMeta.ayanamsa !== undefined ? { ayanamsa: chart.chartMeta.ayanamsa } : {}),
    ...(chart.chartMeta.aspectOrbs ? { aspectOrbs: chart.chartMeta.aspectOrbs } : {}),
    ruleVersion: ASTROLOGY_POINT_RULE_VERSION,
  };

  if (hasPlanet) {
    const key = selector.planet!;
    if (!(ASTROLOGY_POINT_KEYS as readonly string[]).includes(key)) throw new CoreInputError('planet', `未知星体: ${key}`);
    const factor = natalByKey.get(key);
    if (!factor) throw new CoreInputError('planet', '上升点与天顶需要出生地经纬度');
    const ruledHouses = TRADITIONAL_PLANETS.has(key)
      ? chart.natal.houses.filter((house) => DOMICILE_RULER[house.sign.key] === key).map((house) => house.id)
      : undefined;
    return {
      query: { kind: 'planet', key, label: factor.label, focus },
      placement: placementOf(factor, '本命', isApproximate),
      ...(natalPart && TRADITIONAL_PLANETS.has(key) ? { dignities: traditionalDignities(key, factor.sign.key) } : {}),
      ...(natalPart && ruledHouses && !isApproximate ? { ruledHouses } : {}),
      ...(natalPart ? { aspects: natalAspectsOf(key) } : {}),
      ...(transitPart ? { transitAspects: chart.transitToNatalAspects.filter((aspect) => aspect.to.key === key).map((aspect) => aspectRow(aspect, '流运')) } : {}),
      calculationOptions,
    };
  }

  assertInteger(selector.house, 'house', 1, 12);
  if (isApproximate || chart.natal.houses.length !== 12) throw new CoreInputError('house', '宫位需要出生地经纬度');
  const house = chart.natal.houses.find((item) => item.id === selector.house)!;
  const rulerKey = DOMICILE_RULER[house.sign.key];
  const ruler = natalByKey.get(rulerKey)!;
  const span = Number((((house.end.decimal - house.start.decimal) + 360) % 360).toFixed(4));
  return {
    query: { kind: 'house', house: house.id, label: house.label, focus },
    house: {
      id: house.id,
      sign: house.sign.label,
      start: `${house.start.absolute} / ${house.start.withinSign}`,
      end: `${house.end.absolute} / ${house.end.withinSign}`,
      span,
    },
    ...(natalPart ? {
      occupants: natalFactors.filter((factor) => factor.house === house.id).map((factor) => placementOf(factor, '本命', false)),
      ruler: { ...placementOf(ruler, '本命', false), dignities: traditionalDignities(rulerKey, ruler.sign.key) },
      aspects: natalAspectsOf(rulerKey),
    } : {}),
    ...(transitPart ? { transitOccupants: chart.transit.bodies.filter((factor) => inHouse(factor.position.decimal, house)).map((factor) => placementOf(factor, '流运', true)) } : {}),
    calculationOptions,
  };
}
