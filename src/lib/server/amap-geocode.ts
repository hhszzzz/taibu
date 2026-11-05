import {
    type PlaceResolution,
    isAmapPrecisionSufficient,
    normalizePlaceQuery,
} from '@/lib/divination/place-resolution';

const AMAP_GEOCODE_ENDPOINT = 'https://restapi.amap.com/v3/geocode/geo';
/** Bound the per-process cache; a birth-place lookup set is small, but a public form must not grow it forever. */
const GEOCODE_CACHE_LIMIT = 500;
const geocodeCache = new Map<string, Promise<PlaceResolution>>();

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

function buildUnresolved(query: string, reason: PlaceResolution['reason']): PlaceResolution {
    return {
        resolved: false,
        provider: 'amap',
        query,
        reason,
    };
}

function parseCoordinate(value?: string): { longitude: number; latitude: number } | null {
    if (!value) return null;
    const [longitudeRaw, latitudeRaw] = value.split(',');
    const longitude = Number(longitudeRaw);
    const latitude = Number(latitudeRaw);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
    }
    return { longitude, latitude };
}

async function fetchAmapGeocode(query: string, key: string): Promise<PlaceResolution> {
    const params = new URLSearchParams({
        key,
        address: query,
    });
    const response = await fetch(`${AMAP_GEOCODE_ENDPOINT}?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error(`高德地理编码请求失败 (${response.status})`);
    }

    const payload = await response.json() as AmapGeocodeResponse;
    if (payload.status !== '1') {
        throw new Error(payload.info || '高德地理编码返回失败');
    }

    const geocode = payload.geocodes?.[0];
    if (!geocode) {
        return buildUnresolved(query, 'not_found');
    }

    const coordinate = parseCoordinate(geocode.location);
    if (!coordinate) {
        return buildUnresolved(query, 'invalid_location');
    }

    if (!isAmapPrecisionSufficient(geocode.level)) {
        return {
            ...buildUnresolved(query, 'precision_too_low'),
            formattedAddress: geocode.formatted_address,
            adcode: geocode.adcode,
            level: geocode.level,
        };
    }

    return {
        resolved: true,
        provider: 'amap',
        query,
        longitude: coordinate.longitude,
        latitude: coordinate.latitude,
        formattedAddress: geocode.formatted_address,
        adcode: geocode.adcode,
        level: geocode.level,
    };
}

export async function geocodePlaceWithAmap(place: string): Promise<PlaceResolution> {
    const query = normalizePlaceQuery(place);
    if (!query) {
        return buildUnresolved(query, 'not_found');
    }

    const key = process.env.AMAP_WEB_SERVICE_KEY?.trim();
    if (!key) {
        return buildUnresolved(query, 'disabled');
    }

    const cached = geocodeCache.get(query);
    if (cached) {
        return cached;
    }

    const pending = fetchAmapGeocode(query, key);
    if (geocodeCache.size >= GEOCODE_CACHE_LIMIT) {
        const oldest = geocodeCache.keys().next().value;
        if (oldest) geocodeCache.delete(oldest);
    }
    geocodeCache.set(query, pending);
    try {
        return await pending;
    } catch (error) {
        geocodeCache.delete(query);
        throw error;
    }
}
