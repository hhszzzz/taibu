import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRedisClient } from '@/lib/redis.server';
import { compareVersions, type VersionInfo } from '@/lib/version';

const GITHUB_REPO = 'hhszzzz/taibu';
const GITHUB_TIMEOUT_MS = 3000;
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const CACHE_KEY = 'taibu:system:version-info';

export type { VersionInfo };

let localVersion: Promise<string> | null = null;

/** The version this build runs; next.config injects the same value for the client. Read once. */
export function getLocalVersion(): Promise<string> {
  localVersion ??= readLocalVersion();
  return localVersion;
}

async function readLocalVersion(): Promise<string> {
  try {
    const content = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8');
    return (JSON.parse(content) as { version?: string }).version ?? '0.0.0';
  } catch (error) {
    console.warn('[version] failed to read package.json:', error);
    return '0.0.0';
  }
}

type Release = { tag: string; url: string; publishedAt: string; notes: string | null };

/** Latest GitHub release; null when unreachable, unauthenticated or slow. */
async function fetchLatestRelease(): Promise<Release | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'taibu' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      console.warn(`[version] GitHub releases responded ${response.status}`);
      return null;
    }
    const data = await response.json() as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      body?: string | null;
    };
    if (!data.tag_name) return null;
    return {
      tag: data.tag_name,
      url: data.html_url ?? '',
      publishedAt: data.published_at ?? '',
      notes: data.body?.trim() ? data.body : null,
    };
  } catch (error) {
    console.warn('[version] GitHub release lookup failed:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildInfo(current: string, release: Release | null): VersionInfo {
  const latest = release ? release.tag.replace(/^v/u, '') : null;
  return {
    current,
    latest,
    needsUpdate: latest !== null && compareVersions(latest, current) > 0,
    releaseUrl: release?.url || null,
    releaseName: release?.tag ?? null,
    publishedAt: release?.publishedAt || null,
    releaseNotes: release?.notes ?? null,
  };
}

/**
 * Current version plus the latest release, cached for six hours. A failed
 * GitHub lookup never fails the request: the last cached release is reused.
 */
export async function getVersionInfo(): Promise<VersionInfo> {
  const current = await getLocalVersion();

  let redis;
  try {
    redis = getRedisClient();
  } catch {
    redis = null;
  }

  if (redis) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        const release = JSON.parse(cached) as Release | null;
        return buildInfo(current, release);
      }
    } catch (error) {
      console.warn('[version] cache read failed:', error);
    }
  }

  const release = await fetchLatestRelease();
  if (redis && release) {
    try {
      await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(release));
    } catch (error) {
      console.warn('[version] cache write failed:', error);
    }
  }

  return buildInfo(current, release);
}
