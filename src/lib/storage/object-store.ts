/**
 * 文件存储抽象：本地卷实现（P3）与将来的 S3 实现共用。
 *
 * bucket 只有两个，key 是不含主机、不含协议的对象路径；
 * 对外 URL 由 /api/files/avatars 路由统一生成。
 */

export const STORAGE_BUCKETS = ['avatars', 'agent-attachments'] as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

export type PutObjectOptions = {
  contentType?: string;
};

export type StoredObject = {
  stream: ReadableStream<Uint8Array>;
  size: number;
  mtime: Date;
};

export type StoredObjectInfo = {
  key: string;
  size: number;
  mtime: Date;
};

export type ListObjectsOptions = {
  prefix?: string;
  olderThan?: Date;
};

export interface ObjectStore {
  put(bucket: StorageBucket, key: string, body: Uint8Array, options?: PutObjectOptions): Promise<void>;
  get(bucket: StorageBucket, key: string): Promise<StoredObject | null>;
  delete(bucket: StorageBucket, keys: readonly string[]): Promise<void>;
  list(bucket: StorageBucket, options?: ListObjectsOptions): Promise<StoredObjectInfo[]>;
}
