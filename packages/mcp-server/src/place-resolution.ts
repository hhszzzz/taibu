import { getDerivedToolSource, type ToolListPayload, type ToolSchema } from 'taibu-core/mcp';

const AMAP_GEOCODE_ENDPOINT = 'https://restapi.amap.com/v3/geocode/geo';
const PLACE_RESOLUTION_TOOLS = new Set([
  'astrology',
  'bazi',
  'ziwei',
  'ziwei_horoscope',
  'ziwei_flying_star',
]);

export type RuntimePlaceResolutionFallbackReason =
  | 'no_birth_place'
  | 'geocoder_disabled'
  | 'geocode_failed'
  | 'precision_too_low'
  | 'invalid_location';

export type RuntimePlaceResolutionMode = 'coordinates' | 'true_solar_time';

export type RuntimePlaceResolutionInfo = {
  requestedPlace?: string;
  resolved: boolean;
  provider?: 'amap';
  level?: string;
  formattedAddress?: string;
  adcode?: string;
  usedLongitude?: number;
  usedLatitude?: number;
  source: 'manual_input' | 'birth_place' | 'fallback';
  fallbackReason?: RuntimePlaceResolutionFallbackReason;
  locationMode: RuntimePlaceResolutionMode;
};

type PreparedToolArgs = {
  toolArgs: unknown;
  placeResolutionInfo?: RuntimePlaceResolutionInfo;
};

type AmapGeocodeRecord = {
  formatted_address?: string;
  location?: string;
  adcode?: string;
  level?: string;
};

type AmapGeocodeResponse = {
  status?: string;
  info?: string;
  geocodes?: AmapGeocodeRecord[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 详查工具沿用 base 工具的地点解析，保证与原盘使用同一经纬度 */
function placeToolOf(toolName: string): string {
  return getDerivedToolSource(toolName)?.base ?? toolName;
}

function isPlaceResolutionTool(toolName: string): boolean {
  return PLACE_RESOLUTION_TOOLS.has(placeToolOf(toolName));
}

function getPlaceResolutionMode(toolName: string): RuntimePlaceResolutionMode {
  return placeToolOf(toolName) === 'astrology' ? 'coordinates' : 'true_solar_time';
}

function parseLongitude(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= -180 && value <= 180 ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -180 && parsed <= 180 ? parsed : undefined;
}

function parseLatitude(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= -90 && value <= 90 ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -90 && parsed <= 90 ? parsed : undefined;
}

function isAmapPrecisionSufficient(level?: string): boolean {
  const normalized = level?.trim().toLowerCase();
  if (!normalized) return false;

  const insufficientLevels = new Set([
    'province',
    '省',
    '自治区',
    '特别行政区',
    '国家',
  ]);

  return !insufficientLevels.has(normalized);
}

function buildFallbackInfo(
  requestedPlace: string | undefined,
  reason: RuntimePlaceResolutionFallbackReason,
  locationMode: RuntimePlaceResolutionMode,
): RuntimePlaceResolutionInfo {
  return {
    requestedPlace,
    resolved: false,
    source: 'fallback',
    fallbackReason: reason,
    locationMode,
  };
}

function parseCoordinate(location?: string): { longitude: number; latitude: number } | null {
  if (!location) return null;
  const [longitudeRaw, latitudeRaw] = location.split(',');
  const longitude = Number(longitudeRaw);
  const latitude = Number(latitudeRaw);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }
  return { longitude, latitude };
}

async function geocodeBirthPlace(
  place: string,
  locationMode: RuntimePlaceResolutionMode,
): Promise<RuntimePlaceResolutionInfo> {
  const key = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!key) {
    return buildFallbackInfo(place, 'geocoder_disabled', locationMode);
  }

  try {
    const params = new URLSearchParams({
      key,
      address: place.trim(),
    });
    const response = await fetch(`${AMAP_GEOCODE_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      return buildFallbackInfo(place, 'geocode_failed', locationMode);
    }

    const payload = await response.json() as AmapGeocodeResponse;
    if (payload.status !== '1') {
      return buildFallbackInfo(place, 'geocode_failed', locationMode);
    }

    const geocode = payload.geocodes?.[0];
    if (!geocode) {
      return buildFallbackInfo(place, 'geocode_failed', locationMode);
    }

    const coordinate = parseCoordinate(geocode.location);
    if (!coordinate) {
      return buildFallbackInfo(place, 'invalid_location', locationMode);
    }

    if (!isAmapPrecisionSufficient(geocode.level)) {
      return {
        ...buildFallbackInfo(place, 'precision_too_low', locationMode),
        provider: 'amap',
        level: geocode.level,
        formattedAddress: geocode.formatted_address,
        adcode: geocode.adcode,
      };
    }

    return {
      requestedPlace: place,
      resolved: true,
      provider: 'amap',
      level: geocode.level,
      formattedAddress: geocode.formatted_address,
      adcode: geocode.adcode,
      usedLongitude: coordinate.longitude,
      usedLatitude: coordinate.latitude,
      source: 'birth_place',
      locationMode,
    };
  } catch {
    return buildFallbackInfo(place, 'geocode_failed', locationMode);
  }
}

function describeFallbackReason(
  reason: RuntimePlaceResolutionFallbackReason | undefined,
): string {
  switch (reason) {
    case 'no_birth_place':
      return '未提供出生地点';
    case 'geocoder_disabled':
      return '地点解析不可用';
    case 'geocode_failed':
      return '地点解析失败';
    case 'precision_too_low':
      return '地点精度不足';
    case 'invalid_location':
      return '地点坐标无效';
    default:
      return '未完成地点解析';
  }
}

function isAstrologyFullDetailRule(branch: Record<string, unknown> | undefined): boolean {
  if (!branch) return false;
  const condition = branch.if;
  if (!condition || typeof condition !== 'object') return false;
  const detailLevel = (condition as { properties?: Record<string, unknown>; }).properties?.detailLevel;
  return !!detailLevel
    && typeof detailLevel === 'object'
    && 'const' in detailLevel
    && (detailLevel as { const?: unknown; }).const === 'full';
}

function buildAstrologyRuntimeInputSchema(
  inputSchema: ToolListPayload['tools'][number]['inputSchema'],
  inputProperties: ToolListPayload['tools'][number]['inputSchema']['properties'],
): ToolListPayload['tools'][number]['inputSchema'] {
  const baseAllOf = inputSchema.allOf || [];
  let replacedFullRule = false;
  const allOf: ToolSchema[] = baseAllOf.map((branch) => {
    if (!isAstrologyFullDetailRule(branch)) {
      return branch;
    }
    replacedFullRule = true;
    return {
      ...branch,
      then: {
        type: 'object',
        anyOf: [
          {
            type: 'object',
            required: ['latitude', 'longitude'],
          },
          {
            type: 'object',
            required: ['birthPlace'],
          },
        ],
      },
    } satisfies ToolSchema;
  });

  if (!replacedFullRule) {
    allOf.push({
      if: {
        properties: {
          detailLevel: { const: 'full' },
        },
        required: ['detailLevel'],
      },
      then: {
        type: 'object',
        anyOf: [
          {
            type: 'object',
            required: ['latitude', 'longitude'],
          },
          {
            type: 'object',
            required: ['birthPlace'],
          },
        ],
      },
    } satisfies ToolSchema);
  }

  return {
    ...inputSchema,
    properties: inputProperties,
    allOf,
  };
}

function buildBirthPlaceInputDescription(): string {
  return '出生地点文本';
}

function appendPlaceResolutionNote(markdown: string, info: RuntimePlaceResolutionInfo): string {
  const literal = (text: string) => text.replace(/[\r\n]+/gu, ' ').replace(/[\\`*_{}\[\]()#+.!|<>~\-]/gu, '\\$&');
  const lines = ['## 出生地解析'];

  if (info.requestedPlace) {
    lines.push(`- **输入地点**: ${literal(info.requestedPlace)}`);
  }

  if (info.source === 'manual_input') {
    lines.push(`- **来源**: ${info.locationMode === 'coordinates' ? '显式坐标' : '显式经度'}`);
    if (info.usedLongitude != null) lines.push(`- **使用经度**: ${info.usedLongitude}°`);
    if (info.usedLatitude != null) lines.push(`- **使用纬度**: ${info.usedLatitude}°`);
  } else if (info.resolved) {
    lines.push('- **来源**: 地点解析');
    lines.push(`- **解析结果**: ${literal(info.formattedAddress || info.requestedPlace || '-')}`);
    if (info.level) lines.push(`- **解析级别**: ${literal(info.level)}`);
    if (info.usedLongitude != null) lines.push(`- **使用经度**: ${info.usedLongitude}°`);
    if (info.usedLatitude != null) lines.push(`- **使用纬度**: ${info.usedLatitude}°`);
  } else {
    lines.push('- **解析状态**: 未完成');
    lines.push(`- **原因**: ${describeFallbackReason(info.fallbackReason)}`);
    if (info.formattedAddress) {
      lines.push(`- **最近结果**: ${literal(info.formattedAddress)}`);
    }
  }

  return `${markdown}\n\n${lines.join('\n')}`;
}

export async function preprocessToolArgsForRuntimePlace(
  toolName: string,
  args: unknown,
): Promise<PreparedToolArgs> {
  if (!isPlainRecord(args)) {
    return { toolArgs: args };
  }

  const baseArgs = { ...args };
  if (!isPlaceResolutionTool(toolName)) {
    return { toolArgs: baseArgs };
  }

  const manualLongitude = parseLongitude(baseArgs.longitude);
  const manualLatitude = parseLatitude(baseArgs.latitude);
  const requestedPlace = typeof baseArgs.birthPlace === 'string' && baseArgs.birthPlace.trim()
    ? baseArgs.birthPlace.trim()
    : undefined;
  const locationMode = getPlaceResolutionMode(toolName);

  if (manualLongitude != null && (locationMode !== 'coordinates' || manualLatitude != null)) {
    return {
      toolArgs: {
        ...baseArgs,
        longitude: manualLongitude,
        ...(manualLatitude != null ? { latitude: manualLatitude } : {}),
      },
      placeResolutionInfo: {
        requestedPlace,
        resolved: true,
        usedLongitude: manualLongitude,
        ...(manualLatitude != null ? { usedLatitude: manualLatitude } : {}),
        source: 'manual_input',
        locationMode,
      },
    };
  }

  if (!requestedPlace) {
    return {
      toolArgs: baseArgs,
      placeResolutionInfo: buildFallbackInfo(undefined, 'no_birth_place', locationMode),
    };
  }

  const placeResolutionInfo = await geocodeBirthPlace(requestedPlace, locationMode);
  if (placeResolutionInfo.resolved && placeResolutionInfo.usedLongitude != null) {
    return {
      toolArgs: {
        ...baseArgs,
        longitude: placeResolutionInfo.usedLongitude,
        ...(placeResolutionInfo.usedLatitude != null ? { latitude: placeResolutionInfo.usedLatitude } : {}),
      },
      placeResolutionInfo,
    };
  }

  return {
    toolArgs: baseArgs,
    placeResolutionInfo,
  };
}

export function decorateToolListPayloadForRuntime(payload: ToolListPayload): ToolListPayload {
  return {
    ...payload,
    tools: payload.tools.map((tool) => {
      if (!isPlaceResolutionTool(tool.name)) {
        return tool;
      }

      const inputProperties = { ...tool.inputSchema.properties };
      const outputProperties = { ...tool.outputSchema.properties };

      inputProperties.birthPlace = {
        type: 'string',
        description: buildBirthPlaceInputDescription(),
      };

      const inputSchema = placeToolOf(tool.name) === 'astrology'
        ? buildAstrologyRuntimeInputSchema(tool.inputSchema, inputProperties)
        : { ...tool.inputSchema, properties: inputProperties };

      outputProperties.placeResolutionInfo = {
        type: 'object',
        description: '出生地点解析信息',
        properties: {
          requestedPlace: { type: 'string', description: '原始地点文本' },
          resolved: { type: 'boolean', description: '解析成功标记' },
          provider: { type: 'string', description: '解析服务提供方', enum: ['amap'] },
          level: { type: 'string', description: '解析精度级别' },
          formattedAddress: { type: 'string', description: '标准化地点文本' },
          adcode: { type: 'string', description: '行政区编码' },
          usedLongitude: { type: 'number', description: '实际采用的经度' },
          usedLatitude: { type: 'number', description: '实际采用的纬度' },
          source: { type: 'string', description: '地点来源', enum: ['manual_input', 'birth_place', 'fallback'] },
          fallbackReason: {
            type: 'string',
            description: '未采用地点增强的原因',
            enum: ['no_birth_place', 'geocoder_disabled', 'geocode_failed', 'precision_too_low', 'invalid_location'],
          },
          locationMode: { type: 'string', description: '地点增强用途', enum: ['coordinates', 'true_solar_time'] },
        },
      };

      return {
        ...tool,
        inputSchema,
        outputSchema: { ...tool.outputSchema, properties: outputProperties },
      };
    }),
  };
}

export function attachPlaceResolutionInfoToResult(
  result: unknown,
  placeResolutionInfo?: RuntimePlaceResolutionInfo,
): unknown {
  if (!placeResolutionInfo || !isPlainRecord(result)) {
    return result;
  }
  return {
    ...result,
    placeResolutionInfo,
  };
}

export function attachPlaceResolutionNoteToPayload(
  payload: Record<string, unknown>,
  placeResolutionInfo: RuntimePlaceResolutionInfo | undefined,
): Record<string, unknown> {
  if (!placeResolutionInfo) {
    return payload;
  }

  const content = payload.content;
  if (!Array.isArray(content) || content.length === 0) {
    return payload;
  }

  const first = content[0];
  if (!first || typeof first !== 'object' || (first as { type?: unknown }).type !== 'text') {
    return payload;
  }

  const text = String((first as { text?: unknown }).text || '');
  const nextContent = [...content];
  nextContent[0] = {
    ...(first as Record<string, unknown>),
    text: appendPlaceResolutionNote(text, placeResolutionInfo),
  };

  return {
    ...payload,
    content: nextContent,
  };
}
