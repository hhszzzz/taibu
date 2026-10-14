import { requestBrowserData } from '@/lib/browser-api';
import type { KnowledgeBaseWeight } from '@/lib/knowledge-base/types';

export type KnowledgeBaseSummary = {
  id: string;
  name: string;
  description: string | null;
  weight?: KnowledgeBaseWeight;
  created_at?: string;
  updated_at?: string;
};

export type ArchivedSource = {
  id: string;
  kb_id: string;
  source_type: string;
  source_id: string;
  created_at?: string;
  preview?: string | null;
};

type KnowledgeBaseArchivePage = {
  items: ArchivedSource[];
  hasMore: boolean;
  nextOffset: number | null;
};

type KnowledgeBaseArchivePayload = {
  archivedSources?: ArchivedSource[];
  pagination?: {
    hasMore?: boolean;
    nextOffset?: number | null;
  };
};

export async function listKnowledgeBases(options: { signal?: AbortSignal } = {}): Promise<KnowledgeBaseSummary[]> {
  const data = await requestBrowserData<{ knowledgeBases?: KnowledgeBaseSummary[] }>(
    '/api/knowledge-base',
    { method: 'GET', signal: options.signal },
    { fallbackMessage: '获取知识库失败' },
  );

  return Array.isArray(data.knowledgeBases) ? data.knowledgeBases : [];
}

export async function createKnowledgeBase(input: {
  name: string;
  description?: string | null;
  weight?: KnowledgeBaseWeight;
}): Promise<KnowledgeBaseSummary> {
  return await requestBrowserData<KnowledgeBaseSummary>(
    '/api/knowledge-base',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    { fallbackMessage: '创建知识库失败' },
  );
}

export async function updateKnowledgeBase(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    weight?: KnowledgeBaseWeight;
  },
): Promise<KnowledgeBaseSummary> {
  return await requestBrowserData<KnowledgeBaseSummary>(
    `/api/knowledge-base/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    { fallbackMessage: '更新知识库失败' },
  );
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  await requestBrowserData<{ success?: boolean }>(
    `/api/knowledge-base/${id}`,
    { method: 'DELETE' },
    { fallbackMessage: '删除知识库失败' },
  );
}

export async function listKnowledgeBaseArchives(
  kbId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<KnowledgeBaseArchivePage> {
  const params = new URLSearchParams({
    kbId,
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
  });
  const data = await requestBrowserData<KnowledgeBaseArchivePayload>(
    `/api/knowledge-base/archive?${params.toString()}`,
    { method: 'GET' },
    { fallbackMessage: '获取归档失败' },
  );

  return {
    items: Array.isArray(data.archivedSources) ? data.archivedSources : [],
    hasMore: data.pagination?.hasMore === true,
    nextOffset: typeof data.pagination?.nextOffset === 'number'
      ? data.pagination.nextOffset
      : null,
  };
}

export async function ingestKnowledgeBaseSource(input: {
  kbId: string;
  sourceType: string;
  sourceId: string;
  sourceMeta?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const result = await requestBrowserData<Record<string, unknown>>(
    '/api/knowledge-base/ingest',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    { fallbackMessage: '加入知识库失败' },
  );

  return result;
}

export async function removeKnowledgeBaseArchive(id: string): Promise<void> {
  // 上传文件的虚拟归档 id 含文件名，可能带 `/`、`#`、`?` 等字符，必须整体编码为一个路径段。
  await requestBrowserData<{ success?: boolean }>(
    `/api/knowledge-base/archive/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    { fallbackMessage: '取消归档失败' },
  );
}

export async function uploadKnowledgeBaseFile(
  kbId: string,
  file: File,
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append('kbId', kbId);
  formData.append('file', file);

  return await requestBrowserData<Record<string, unknown>>(
    '/api/knowledge-base/upload',
    {
      method: 'POST',
      body: formData,
    },
    { fallbackMessage: '上传失败' },
  );
}
