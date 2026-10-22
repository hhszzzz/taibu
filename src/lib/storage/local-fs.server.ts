import 'server-only';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  STORAGE_BUCKETS,
  type ListObjectsOptions,
  type ObjectStore,
  type PutObjectOptions,
  type StorageBucket,
  type StoredObject,
  type StoredObjectInfo,
} from './object-store';

/** Segments allow dot-prefixed names but never a bare `.` or `..`. */
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}(?:\/[A-Za-z0-9._-]{1,200})*$/u;

export function isStorageBucket(value: string): value is StorageBucket {
  return (STORAGE_BUCKETS as readonly string[]).includes(value);
}

export function assertObjectKey(key: string): void {
  if (!OBJECT_KEY_PATTERN.test(key) || key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid storage key');
  }
}

export function createLocalObjectStore(root: string): ObjectStore {
  const rootDir = path.resolve(root);

  const bucketDir = (bucket: StorageBucket) => {
    if (!isStorageBucket(bucket)) throw new Error('Unsupported storage bucket');
    return path.join(rootDir, bucket);
  };

  const resolveObjectPath = (bucket: StorageBucket, key: string) => {
    const base = bucketDir(bucket);
    assertObjectKey(key);
    const resolved = path.resolve(base, key);
    if (!resolved.startsWith(`${base}${path.sep}`)) {
      throw new Error('Storage key escapes the bucket root');
    }
    return resolved;
  };

  const walk = async (
    directory: string,
    base: string,
    options: ListObjectsOptions,
    output: StoredObjectInfo[],
  ): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, base, options, output);
        continue;
      }
      if (!entry.isFile()) continue;
      const key = path.relative(base, absolute).split(path.sep).join('/');
      if (options.prefix && !key.startsWith(options.prefix)) continue;
      const info = await stat(absolute);
      if (options.olderThan && info.mtime.getTime() >= options.olderThan.getTime()) continue;
      output.push({ key, size: info.size, mtime: info.mtime });
    }
  };

  return {
    async put(bucket, key, body, options?: PutObjectOptions) {
      // 本地实现按扩展名推断 Content-Type；contentType 仅为将来的 S3 驱动保留。
      void options;
      const target = resolveObjectPath(bucket, key);
      const directory = path.dirname(target);
      await mkdir(directory, { recursive: true, mode: 0o750 });
      const temporary = path.join(directory, `.tmp-${randomUUID()}`);
      try {
        await writeFile(temporary, body, { mode: 0o640 });
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    },

    async get(bucket, key): Promise<StoredObject | null> {
      const target = resolveObjectPath(bucket, key);
      let info;
      try {
        info = await stat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      if (!info.isFile()) return null;
      const stream = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
      return { stream, size: info.size, mtime: info.mtime };
    },

    async delete(bucket, keys) {
      for (const key of keys) {
        await rm(resolveObjectPath(bucket, key), { force: true });
      }
    },

    async list(bucket, options: ListObjectsOptions = {}) {
      if (options.prefix !== undefined
        && (!/^[A-Za-z0-9._/-]*$/u.test(options.prefix)
          || options.prefix.split('/').some((segment) => segment === '.' || segment === '..'))) {
        throw new Error('Invalid storage prefix');
      }
      const output: StoredObjectInfo[] = [];
      await walk(bucketDir(bucket), bucketDir(bucket), options, output);
      return output.sort((left, right) => left.key.localeCompare(right.key));
    },
  };
}
