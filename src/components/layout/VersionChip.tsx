/**
 * Version chip next to the brand, for administrators only.
 * It adds an update dot and the update dialog once GitHub reports a newer release.
 */
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useCurrentUserProfile } from '@/lib/hooks/useCurrentUserProfile';
import type { VersionInfo } from '@/lib/version';
import { UpdateDialog } from '@/components/admin/UpdateDialog';

const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
const VERSION_CACHE_KEY = 'taibu:version-info';
const IGNORED_VERSION_KEY = 'taibu:ignored-version';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

function readIgnoredVersion(): string | null {
  try {
    return localStorage.getItem(IGNORED_VERSION_KEY);
  } catch {
    return null;
  }
}

function readCachedVersion(): VersionInfo | null {
  try {
    const raw = localStorage.getItem(VERSION_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { version: VersionInfo; timestamp: number };
    return Date.now() - cached.timestamp > CHECK_INTERVAL ? null : cached.version;
  } catch {
    return null;
  }
}

function writeCachedVersion(version: VersionInfo) {
  try {
    localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify({ version, timestamp: Date.now() }));
  } catch {
    // Private mode or quota exceeded: the chip still works, just without a cache.
  }
}

async function fetchVersionInfo(): Promise<VersionInfo | null> {
  try {
    const response = await fetch('/api/admin/system/version');
    return response.ok ? await response.json() as VersionInfo : null;
  } catch {
    return null;
  }
}

interface VersionChipProps {
  className?: string;
}

export function VersionChip({ className }: VersionChipProps) {
  const { profile } = useCurrentUserProfile();
  const isAdmin = profile?.is_admin === true;
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [ignoredVersion, setIgnoredVersion] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    // localStorage is browser-only; read it after hydration, not during render.
    queueMicrotask(() => setIgnoredVersion(readIgnoredVersion()));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const load = async () => {
      const cached = readCachedVersion();
      if (cached && !cancelled) setVersionInfo(cached);
      const info = await fetchVersionInfo();
      if (cancelled || !info) return;
      setVersionInfo(info);
      writeCachedVersion(info);
    };

    void load();
    const timer = setInterval(() => { void load(); }, CHECK_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAdmin]);

  const latest = versionInfo?.latest ?? null;
  const showUpdateDot = versionInfo?.needsUpdate === true && latest !== null && latest !== ignoredVersion;

  const chip = (
    <>
      <span className="hidden sm:inline">{CURRENT_VERSION}</span>
      {showUpdateDot && (
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
      )}
    </>
  );

  if (!isAdmin) return null;

  if (!versionInfo) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs text-foreground-secondary ${className ?? ''}`}
        title={`当前版本 ${CURRENT_VERSION}`}
      >
        {chip}
      </span>
    );
  }

  return (
    <>
      <Button
        unstyled
        aria-haspopup="dialog"
        aria-label={showUpdateDot ? `当前版本 ${CURRENT_VERSION}，有新版本 ${latest}` : `当前版本 ${CURRENT_VERSION}`}
        onClick={() => setDialogOpen(true)}
        className={`relative inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-foreground-secondary transition-colors hover:text-foreground ${className ?? ''}`}
      >
        {chip}
      </Button>
      {dialogOpen && (
        <UpdateDialog
          versionInfo={versionInfo}
          onClose={() => setDialogOpen(false)}
          onIgnore={() => {
            try {
              if (latest) localStorage.setItem(IGNORED_VERSION_KEY, latest);
            } catch {
              // Ignoring is a nicety; storage may be unavailable.
            }
            setIgnoredVersion(latest);
            setDialogOpen(false);
          }}
        />
      )}
    </>
  );
}
