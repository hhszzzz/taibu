import { createRequire } from 'node:module';
import { Body, Ecliptic, GeoVector, SiderealTime } from 'astronomy-engine';
import { assertFiniteNumber, CoreInputError, resolveEnum, validateCivilDateTime } from '../../shared/validation.js';
import { getZonedDateTimeParts, zonedTimeToUtc } from '../../shared/timezone-utils.js';

import type { AstrologyAspect, AstrologyAspectType, AstrologyChartSnapshot, AstrologyDegreeInfo, AstrologyFactor, AstrologyFactorCategory, AstrologyHouse, AstrologyInput, AstrologyOutput, AstrologySignInfo, AstrologyZodiacCusp } from './types.js';

const require = createRequire(import.meta.url);
const horoscopePackage = require('circular-natal-horoscope-js') as typeof import('circular-natal-horoscope-js');
const { Origin, Horoscope } = horoscopePackage;

export type {
  AstrologyAspect,
  AstrologyAspectType,
  AstrologyChartSnapshot,
  AstrologyFactor,
  AstrologyFactorCategory,
  AstrologyHouse,
  AstrologyHouseSystem,
  AstrologyInput,
  AstrologyOutput,
  AstrologySignInfo,
  AstrologyZodiacCusp,
} from './types.js';

const BODY_KEYS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;
const POINT_KEYS = ['northnode', 'southnode', 'lilith'] as const;
const ANGLE_KEYS = ['ascendant', 'midheaven'] as const;
const MAJOR_ASPECT_TYPES = ['conjunction', 'opposition', 'trine', 'square', 'sextile'] as const;
const SUPPORTED_ASPECT_KEYS = [...BODY_KEYS, ...POINT_KEYS, ...ANGLE_KEYS] as const;

const BODY_LABELS: Record<string, string> = {
  sun: '太阳',
  moon: '月亮',
  mercury: '水星',
  venus: '金星',
  mars: '火星',
  jupiter: '木星',
  saturn: '土星',
  uranus: '天王星',
  neptune: '海王星',
  pluto: '冥王星',
  northnode: '北交点',
  southnode: '南交点',
  lilith: '莉莉丝',
  ascendant: '上升点',
  midheaven: '天顶',
};

const SIGN_LABELS: Record<string, { label: string; element: string; modality: string; }> = {
  aries: { label: '白羊座', element: '火', modality: '本位' },
  taurus: { label: '金牛座', element: '土', modality: '固定' },
  gemini: { label: '双子座', element: '风', modality: '变动' },
  cancer: { label: '巨蟹座', element: '水', modality: '本位' },
  leo: { label: '狮子座', element: '火', modality: '固定' },
  virgo: { label: '处女座', element: '土', modality: '变动' },
  libra: { label: '天秤座', element: '风', modality: '本位' },
  scorpio: { label: '天蝎座', element: '水', modality: '固定' },
  sagittarius: { label: '射手座', element: '火', modality: '变动' },
  capricorn: { label: '摩羯座', element: '土', modality: '本位' },
  aquarius: { label: '水瓶座', element: '风', modality: '固定' },
  pisces: { label: '双鱼座', element: '水', modality: '变动' },
};

const ASPECT_LABELS: Record<AstrologyAspectType, string> = {
  conjunction: '合相',
  opposition: '对冲',
  trine: '三分',
  square: '四分',
  sextile: '六合',
};

const ASPECT_ANGLES: Record<AstrologyAspectType, { angle: number; orb: number; }> = {
  conjunction: { angle: 0, orb: 8 },
  opposition: { angle: 180, orb: 8 },
  trine: { angle: 120, orb: 8 },
  square: { angle: 90, orb: 7 },
  sextile: { angle: 60, orb: 6 },
};

const APPROXIMATE_COORDINATE_FALLBACK = {
  latitude: 0,
  longitude: 0,
} as const;

type AstrologyLocationContext = {
  latitude: number;
  longitude: number;
  calculationMode: AstrologyOutput['chartMeta']['calculationMode'];
  coordinateSource: AstrologyChartSnapshot['origin']['coordinateSource'];
  calculationNote?: string;
};

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type HoroscopeSignLike = {
  key?: string;
  label?: string;
};

type HoroscopeFactorLike = {
  key: string;
  label?: string;
  Sign: HoroscopeSignLike;
  House?: { id?: number; };
  isRetrograde?: boolean;
  ChartPosition: {
    Ecliptic: {
      DecimalDegrees: number;
    };
  };
};

type HoroscopeHouseLike = {
  id: number;
  Sign: HoroscopeSignLike;
  ChartPosition: {
    StartPosition: {
      Ecliptic: {
        DecimalDegrees: number;
      };
    };
    EndPosition: {
      Ecliptic: {
        DecimalDegrees: number;
      };
    };
  };
};

type HoroscopeZodiacCuspLike = {
  Sign: HoroscopeSignLike;
  ChartPosition: {
    Ecliptic: {
      DecimalDegrees: number;
    };
  };
};

function ensureRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} 必须在 ${min} 到 ${max} 之间`);
  }
}

function ensureInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} 必须是 ${min}-${max} 的整数`);
  }
}

function ensureValidCivilDate(year: number, month: number, day: number, label: string): void {
  validateCivilDateTime({ year, month, day }, label);
}

function normalizeBirthInput(input: AstrologyInput) {
  ensureInteger(input.birthYear, 1, 9999, 'birthYear');
  ensureInteger(input.birthMonth, 1, 12, 'birthMonth');
  ensureInteger(input.birthDay, 1, 31, 'birthDay');
  ensureInteger(input.birthHour, 0, 23, 'birthHour');
  const birthMinute = input.birthMinute ?? 0;
  ensureInteger(birthMinute, 0, 59, 'birthMinute');
  ensureValidCivilDate(input.birthYear, input.birthMonth, input.birthDay, 'birth');
  return {
    birthYear: input.birthYear,
    birthMonth: input.birthMonth,
    birthDay: input.birthDay,
    birthHour: input.birthHour,
    birthMinute,
  };
}

function resolveLocationContext(input: AstrologyInput): AstrologyLocationContext {
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;

  if (hasLatitude !== hasLongitude) {
    throw new Error('latitude 和 longitude 需要同时提供，或同时省略');
  }

  if (hasLatitude && hasLongitude) {
    ensureRange(input.latitude as number, -90, 90, 'latitude');
    ensureRange(input.longitude as number, -180, 180, 'longitude');
    return {
      latitude: input.latitude as number,
      longitude: input.longitude as number,
      calculationMode: 'exact',
      coordinateSource: 'provided',
    };
  }

  return {
    ...APPROXIMATE_COORDINATE_FALLBACK,
    calculationMode: 'approximate',
    coordinateSource: 'assumed_zero',
    calculationNote: `未提供完整经纬度，已按 0°N, 0°E 与 ${input.timezone ?? 'Etc/GMT'} 近似计算；上升、天顶、宫位不作为默认输出。`,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTimeParts(parts: { year: number; month: number; day: number; hour: number; minute: number; second: number; }): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function getTimeZoneParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; } {
  return getZonedDateTimeParts(date, timeZone);
}

function validateDateTimeParts(parts: DateTimeParts, label: string): DateTimeParts {
  ensureInteger(parts.year, 1, 9999, `${label}.year`);
  ensureInteger(parts.month, 1, 12, `${label}.month`);
  ensureInteger(parts.day, 1, 31, `${label}.day`);
  ensureInteger(parts.hour, 0, 23, `${label}.hour`);
  ensureInteger(parts.minute, 0, 59, `${label}.minute`);
  ensureInteger(parts.second, 0, 59, `${label}.second`);
  ensureValidCivilDate(parts.year, parts.month, parts.day, label);
  return parts;
}

function parseTransitDateTime(value: string | undefined, derivedTimeZone: string) {
  if (!value) {
    return getTimeZoneParts(new Date(), derivedTimeZone);
  }

  const trimmed = value.trim();
  const naive = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (naive) {
    return validateDateTimeParts({
      year: Number(naive[1]),
      month: Number(naive[2]),
      day: Number(naive[3]),
      hour: Number(naive[4]),
      minute: Number(naive[5]),
      second: Number(naive[6] ?? '0'),
    }, 'transitDateTime');
  }

  const zoned = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (zoned) {
    validateDateTimeParts({
      year: Number(zoned[1]),
      month: Number(zoned[2]),
      day: Number(zoned[3]),
      hour: Number(zoned[4]),
      minute: Number(zoned[5]),
      second: Number(zoned[6] ?? '0'),
    }, 'transitDateTime');

    if (zoned[7] !== 'Z') {
      ensureInteger(Number(zoned[9]), 0, 23, 'transitDateTime.offsetHour');
      ensureInteger(Number(zoned[10]), 0, 59, 'transitDateTime.offsetMinute');
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('transitDateTime 格式无效，请使用 YYYY-MM-DDTHH:mm[:ss] 或带时区偏移的 ISO 时间');
    }
    return getTimeZoneParts(parsed, derivedTimeZone);
  }

  throw new Error('transitDateTime 格式无效，请使用 YYYY-MM-DDTHH:mm[:ss] 或带时区偏移的 ISO 时间');
}

function formatDegrees(decimal: number): AstrologyDegreeInfo {
  const normalized = ((decimal % 360) + 360) % 360;
  const absoluteDegrees = Math.floor(normalized);
  const absoluteMinutes = Math.floor((normalized - absoluteDegrees) * 60);
  const withinSign = normalized % 30;
  const withinSignDegrees = Math.floor(withinSign);
  const withinSignMinutes = Math.floor((withinSign - withinSignDegrees) * 60);
  return {
    decimal: Number(normalized.toFixed(4)),
    absolute: `${absoluteDegrees}°${pad(absoluteMinutes)}`,
    withinSign: `${withinSignDegrees}°${pad(withinSignMinutes)}`,
  };
}

function buildSignInfo(sign: { key?: string; label?: string; }): AstrologySignInfo {
  const key = String(sign?.key || '').toLowerCase();
  const found = SIGN_LABELS[key] || { label: sign?.label || key || '未知', element: '未知', modality: '未知' };
  return {
    key,
    label: found.label,
    element: found.element,
    modality: found.modality,
  };
}

function buildFactor(entity: HoroscopeFactorLike, category: AstrologyFactorCategory): AstrologyFactor {
  return {
    key: entity.key,
    label: BODY_LABELS[entity.key] || entity.label || entity.key,
    category,
    sign: buildSignInfo(entity.Sign),
    ...(typeof entity.House?.id === 'number' ? { house: entity.House.id } : {}),
    ...(typeof entity.isRetrograde === 'boolean' ? { retrograde: entity.isRetrograde } : {}),
    position: formatDegrees(entity.ChartPosition.Ecliptic.DecimalDegrees),
  };
}

function buildHouse(entity: HoroscopeHouseLike): AstrologyHouse {
  return {
    id: entity.id,
    label: `第${entity.id}宫`,
    sign: buildSignInfo(entity.Sign),
    start: formatDegrees(entity.ChartPosition.StartPosition.Ecliptic.DecimalDegrees),
    end: formatDegrees(entity.ChartPosition.EndPosition.Ecliptic.DecimalDegrees),
  };
}

function buildZodiacCusp(entity: HoroscopeZodiacCuspLike): AstrologyZodiacCusp {
  return {
    sign: buildSignInfo(entity.Sign),
    start: formatDegrees(entity.ChartPosition.Ecliptic.DecimalDegrees),
  };
}

function computeAngularDistance(left: number, right: number): number {
  const diffRaw = Math.abs(left - right);
  const diff = diffRaw > 180 ? 360 - diffRaw : diffRaw;
  return Number(diff.toFixed(4));
}

function computeMajorAspect(from: AstrologyFactor, to: AstrologyFactor, orbs: NonNullable<AstrologyInput['aspectOrbs']>): AstrologyAspect | null {
  const diff = computeAngularDistance(from.position.decimal, to.position.decimal);

  for (const type of MAJOR_ASPECT_TYPES) {
    const target = ASPECT_ANGLES[type];
    const orb = Math.abs(diff - target.angle);
    if (orb <= (orbs[type] ?? target.orb)) {
      return {
        type,
        label: ASPECT_LABELS[type],
        from: { key: from.key, label: from.label, category: from.category },
        to: { key: to.key, label: to.label, category: to.category },
        orb: Number(orb.toFixed(4)),
        actualAngle: Number(diff.toFixed(4)),
      };
    }
  }

  return null;
}

function createHoroscope(origin: InstanceType<typeof Origin>, includeAngles: boolean, input: AstrologyInput) {
  const aspectKeys = includeAngles
    ? [...SUPPORTED_ASPECT_KEYS]
    : [...BODY_KEYS, ...POINT_KEYS];
  return new Horoscope({
    origin,
    houseSystem: input.houseSystem ?? 'placidus',
    zodiac: 'tropical',
    aspectPoints: aspectKeys,
    aspectWithPoints: aspectKeys,
    aspectTypes: [...MAJOR_ASPECT_TYPES],
    language: 'en',
  });
}

function buildHoroscopeSnapshot(
  origin: InstanceType<typeof Origin>,
  locationContext: AstrologyLocationContext,
  birthPlace?: string,
  input: AstrologyInput = {} as AstrologyInput,
): AstrologyChartSnapshot {
  const includeAngles = locationContext.calculationMode === 'exact';
  const horoscope = createHoroscope(origin, includeAngles, input);

  const bodies = BODY_KEYS.map((key) => buildFactor(horoscope.CelestialBodies[key] as HoroscopeFactorLike, 'body'));
  const points = POINT_KEYS.map((key) => buildFactor(horoscope.CelestialPoints[key] as HoroscopeFactorLike, 'point'));
  const angles = includeAngles
    ? ANGLE_KEYS.map((key) => buildFactor(horoscope.Angles[key] as HoroscopeFactorLike, 'angle'))
    : [];
  const houses = includeAngles
    ? (horoscope.Houses as HoroscopeHouseLike[]).map((house) => buildHouse(house))
    : [];
  const zodiacCusps = (horoscope.ZodiacCusps as HoroscopeZodiacCuspLike[]).map((cusp) => buildZodiacCusp(cusp));

  const instant = new Date(origin.utcTime.valueOf());
  const astronomicalBodies: Record<string, Body> = { sun: Body.Sun, moon: Body.Moon, mercury: Body.Mercury, venus: Body.Venus, mars: Body.Mars, jupiter: Body.Jupiter, saturn: Body.Saturn, uranus: Body.Uranus, neptune: Body.Neptune, pluto: Body.Pluto };
  const longitude = (key: string, date: Date) => Ecliptic(GeoVector(astronomicalBodies[key], date, true)).elon;
  for (const body of bodies) {
    body.position = formatDegrees(longitude(body.key, instant));
    const before = longitude(body.key, new Date(instant.getTime() - 3600000));
    const after = longitude(body.key, new Date(instant.getTime() + 3600000));
    body.retrograde = ((after - before + 540) % 360) - 180 < 0;
  }
  const offset = input.zodiac === 'sidereal' ? input.ayanamsa! : 0;
  const signAt = (degrees: number) => buildSignInfo({ key: Object.keys(SIGN_LABELS)[Math.floor(((degrees % 360) + 360) % 360 / 30)] });
  for (const factor of [...bodies, ...points, ...angles]) {
    factor.position = formatDegrees(factor.position.decimal - offset);
    factor.sign = signAt(factor.position.decimal);
  }
  for (const house of houses) {
    house.start = formatDegrees(house.start.decimal - offset);
    house.end = formatDegrees(house.end.decimal - offset);
    house.sign = signAt(house.start.decimal);
  }
  // The upstream backend sets the twelfth end to zero. Every house ends at the next house's cusp.
  houses.forEach((house, index) => { house.end = { ...houses[(index + 1) % houses.length].start }; });
  // Whole-sign house boundaries are aligned to the selected zodiac, not the tropical zodiac.
  if (includeAngles && input.houseSystem === 'whole-sign') {
    const start = Math.floor(angles[0].position.decimal / 30) * 30;
    houses.forEach((house, index) => {
      house.start = formatDegrees(start + index * 30);
      house.end = formatDegrees(start + (index + 1) * 30);
      house.sign = signAt(house.start.decimal);
    });
  }
  if (houses.length) {
    const widths = houses.map(house => (house.end.decimal - house.start.decimal + 360) % 360);
    if (houses.length !== 12 || widths.some(width => !Number.isFinite(width) || width < 0.0001 || width >= 180) || Math.abs(widths.reduce((a, b) => a + b, 0) - 360) > 0.01) {
      throw new CoreInputError('houseSystem', '该地点无法生成有效宫头，请选择 equal-house 或 whole-sign', 'UNDEFINED_HOUSES');
    }
  }
  for (const factor of [...bodies, ...points, ...angles]) {
    const house = houses.find(house => ((factor.position.decimal - house.start.decimal + 360) % 360) < ((house.end.decimal - house.start.decimal + 360) % 360));
    if (house) factor.house = house.id;
    else delete factor.house;
  }
  zodiacCusps.forEach((cusp, index) => { cusp.start = formatDegrees(index * 30); cusp.sign = signAt(index * 30); });

  return {
    origin: {
      localDateTime: formatDateTimeParts(getZonedDateTimeParts(instant, input.timezone ?? origin.timezone.name)),
      derivedTimeZone: input.timezone ?? origin.timezone?.name ?? 'unknown',
      timezoneSource: input.timezone !== undefined ? 'provided' : locationContext.coordinateSource === 'provided' ? 'coordinates' : 'default',
      utcDateTime: instant.toISOString(),
      latitude: origin.latitude,
      longitude: origin.longitude,
      coordinateSource: locationContext.coordinateSource,
      ...(birthPlace ? { birthPlace } : {}),
    },
    sunSign: bodies[0].sign,
    bodies,
    points,
    angles,
    houses,
    zodiacCusps,
  };
}

function createNatalOrigin(input: AstrologyInput, locationContext: AstrologyLocationContext) {
  const birth = normalizeBirthInput(input);
  const origin = new Origin({
    year: birth.birthYear,
    month: birth.birthMonth - 1,
    date: birth.birthDay,
    hour: birth.birthHour,
    minute: birth.birthMinute,
    second: 0,
    latitude: locationContext.latitude,
    longitude: locationContext.longitude,
  });
  return alignOrigin(origin, { year: birth.birthYear, month: birth.birthMonth, day: birth.birthDay, hour: birth.birthHour, minute: birth.birthMinute, second: 0 }, input);
}

function alignOrigin(origin: InstanceType<typeof Origin>, parts: DateTimeParts, input: AstrologyInput, explicitInstant?: Date) {
  const instant = explicitInstant ?? zonedTimeToUtc(parts, input.timezone ?? origin.timezone.name, input.disambiguation ?? 'reject');
  // The house backend infers timezones from coordinates. Override its time basis with the resolved instant.
  origin.utcTime = origin.utcTime.clone().add(instant.getTime() - origin.utcTime.valueOf(), 'milliseconds');
  origin.julianDate = instant.getTime() / 86400000 + 2440587.5;
  origin.localSiderealTime = ((SiderealTime(instant) * 15 + origin.longitude) % 360 + 360) % 360;
  return origin;
}

function createTransitOrigin(
  input: AstrologyInput,
  derivedTimeZone: string,
  locationContext: AstrologyLocationContext,
) {
  const transit = parseTransitDateTime(input.transitDateTime, derivedTimeZone);
  ensureInteger(transit.month, 1, 12, 'transitDateTime.month');
  ensureInteger(transit.day, 1, 31, 'transitDateTime.day');
  ensureInteger(transit.hour, 0, 23, 'transitDateTime.hour');
  ensureInteger(transit.minute, 0, 59, 'transitDateTime.minute');
  ensureInteger(transit.second, 0, 59, 'transitDateTime.second');

  const origin = new Origin({
    year: transit.year,
    month: transit.month - 1,
    date: transit.day,
    hour: transit.hour,
    minute: transit.minute,
    second: transit.second,
    latitude: locationContext.latitude,
    longitude: locationContext.longitude,
  });
  const explicitInstant = input.transitDateTime && /(Z|[+-]\d{2}:\d{2})$/.test(input.transitDateTime.trim())
    ? new Date(input.transitDateTime.trim())
    : input.transitDateTime === undefined ? new Date() : undefined;
  return alignOrigin(origin, transit, input, explicitInstant);
}

// 南交点恒在北交点对面：这组 0° 容许度的对冲是定义而非相位，不应排在本命相位首位
function isNodeAxis(left: AstrologyFactor, right: AstrologyFactor): boolean {
  return (left.key === 'northnode' && right.key === 'southnode') || (left.key === 'southnode' && right.key === 'northnode');
}

function sortAspects(aspects: AstrologyAspect[]): AstrologyAspect[] {
  return [...aspects].sort((left, right) => {
    if (left.orb !== right.orb) return left.orb - right.orb;
    if (left.from.label !== right.from.label) return left.from.label.localeCompare(right.from.label, 'zh-CN');
    return left.to.label.localeCompare(right.to.label, 'zh-CN');
  });
}

export function calculateAstrology(input: AstrologyInput): AstrologyOutput {
  const houseSystem = resolveEnum(input.houseSystem, ['placidus', 'equal-house', 'whole-sign', 'koch', 'campanus', 'regiomontanus', 'topocentric'] as const, 'placidus', 'houseSystem');
  const zodiac = resolveEnum(input.zodiac, ['tropical', 'sidereal'] as const, 'tropical', 'zodiac');
  resolveEnum(input.disambiguation, ['reject', 'earlier', 'later', 'compatible'], 'reject', 'disambiguation');
  if (zodiac === 'sidereal') assertFiniteNumber(input.ayanamsa, 'ayanamsa', 0, 360);
  else if (input.ayanamsa !== undefined) throw new CoreInputError('ayanamsa', '仅用于 sidereal');
  const aspectOrbs = { ...Object.fromEntries(MAJOR_ASPECT_TYPES.map(type => [type, ASPECT_ANGLES[type].orb])) } as NonNullable<AstrologyInput['aspectOrbs']>;
  if (input.aspectOrbs !== undefined && (!input.aspectOrbs || typeof input.aspectOrbs !== 'object' || Array.isArray(input.aspectOrbs))) throw new CoreInputError('aspectOrbs', '必须是相位容许度对象');
  for (const [type, orb] of Object.entries(input.aspectOrbs ?? {})) {
    if (!(MAJOR_ASPECT_TYPES as readonly string[]).includes(type)) throw new CoreInputError(`aspectOrbs.${type}`, '未知相位');
    assertFiniteNumber(orb, `aspectOrbs.${type}`, 0, 15);
    aspectOrbs[type as AstrologyAspectType] = orb;
  }
  input = { ...input, houseSystem, zodiac };
  const locationContext = resolveLocationContext(input);
  if (locationContext.calculationMode === 'exact' && Math.abs(locationContext.latitude) === 90) throw new CoreInputError('latitude', '极点无法定义上升点和宫位', 'UNDEFINED_HOUSES');
  if (locationContext.calculationMode === 'exact' && ['placidus', 'koch', 'topocentric'].includes(houseSystem) && Math.abs(locationContext.latitude) >= 66.5) throw new CoreInputError('houseSystem', '高纬度下该宫制不完整，请选择 equal-house 或 whole-sign', 'UNDEFINED_HOUSES');
  const natalOrigin = createNatalOrigin(input, locationContext);
  const natal = buildHoroscopeSnapshot(natalOrigin, locationContext, input.birthPlace, input);
  const transitOrigin = createTransitOrigin(input, natal.origin.derivedTimeZone, locationContext);
  const transit = buildHoroscopeSnapshot(transitOrigin, locationContext, input.birthPlace, input);

  const natalFactors = [...natal.bodies, ...natal.points, ...natal.angles];
  const majorAspects = sortAspects(natalFactors.flatMap((from, index) => natalFactors.slice(index + 1).flatMap(to => {
    if (isNodeAxis(from, to)) return [];
    const aspect = computeMajorAspect(from, to, aspectOrbs);
    return aspect ? [aspect] : [];
  })));

  const transitFactors = [...transit.bodies, ...transit.points];
  const natalTargets = [...natal.bodies, ...natal.points, ...natal.angles];
  const transitToNatalAspects = sortAspects(
    transitFactors.flatMap((from) =>
      natalTargets.flatMap((to) => {
        const aspect = computeMajorAspect(from, to, aspectOrbs);
        return aspect ? [aspect] : [];
      })),
  );

  return {
    chartMeta: {
      zodiac,
      houseSystem,
      supportedBodies: [...BODY_KEYS],
      supportedAspectTypes: [...MAJOR_ASPECT_TYPES],
      calculationMode: locationContext.calculationMode,
      ephemeris: 'astronomy-engine@2.1.19',
      ruleVersion: 'astrology-2026.10',
      coordinateFrame: 'geocentric apparent true ecliptic of date (light time and aberration)',
      ...(zodiac === 'sidereal' ? { ayanamsa: input.ayanamsa } : {}),
      aspectOrbs,
      ...(locationContext.calculationNote ? { calculationNote: locationContext.calculationNote } : {}),
    },
    natal,
    transit,
    majorAspects,
    transitToNatalAspects,
  };
}
