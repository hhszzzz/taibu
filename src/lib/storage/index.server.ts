import 'server-only';

import type { ObjectStore } from './object-store';
import { createLocalObjectStore } from './local-fs.server';

let cachedStore: ObjectStore | null = null;
let cachedKey: string | null = null;

/**
 * 按环境选择存储驱动。目前只有 local；`s3` 在 P3 只保留接口，
 * 配置成未知驱动时 fail-closed，避免悄悄退回本机目录。
 */
export function getObjectStore(): ObjectStore {
  const driver = process.env.FILE_STORAGE_DRIVER ?? 'local';
  const root = process.env.FILE_STORAGE_ROOT ?? '/data/files';
  const key = `${driver}:${root}`;
  if (cachedStore && cachedKey === key) return cachedStore;
  if (driver !== 'local') {
    throw new Error(`Unsupported FILE_STORAGE_DRIVER: ${driver}`);
  }
  cachedStore = createLocalObjectStore(root);
  cachedKey = key;
  return cachedStore;
}
