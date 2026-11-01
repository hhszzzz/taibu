/** Release information shared by the version endpoint and the sidebar chip. */
export interface VersionInfo {
  current: string;
  latest: string | null;
  needsUpdate: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  /** GitHub release body (Markdown); null when the release has none. */
  releaseNotes: string | null;
}

/** Compares dotted numeric versions; a non-numeric suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.replace(/^v/u, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
