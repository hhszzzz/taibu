/**
 * 命理记录服务
 *
 * 浏览器侧统一通过 records/notes API 访问数据。
 */

import { requestBrowserData } from '@/lib/browser-api';
import { isValidUUID } from '@/lib/validation';

// =====================================================
// 类型定义
// =====================================================

export type RecordCategory = 'general' | 'prediction' | 'event' | 'reflection';

export type NoteMood = 'happy' | 'neutral' | 'sad' | 'anxious' | 'peaceful';

export interface MingRecord {
    id: string;
    user_id: string;
    title: string;
    content: string | null;
    category: RecordCategory;
    tags: string[];
    event_date: string | null;
    related_chart_type: string | null;
    related_chart_id: string | null;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
    is_archived?: boolean;
    archived_kb_ids?: string[] | null;
}

export interface MingNote {
    id: string;
    user_id: string;
    note_date: string;
    content: string;
    mood: NoteMood | null;
    created_at: string;
    updated_at: string;
}

interface RecordInput {
    title: string;
    content?: string | null;
    category?: RecordCategory;
    tags?: string[];
    event_date?: string | null;
    related_chart_type?: string | null;
    related_chart_id?: string | null;
    is_pinned?: boolean;
}

interface NoteInput {
    note_date?: string | null;
    content: string;
    mood?: NoteMood | null;
}

export interface RecordFilters {
    category?: RecordCategory;
    search?: string;
    startDate?: string;
    endDate?: string;
    tags?: string[];
    isPinned?: boolean;
}

export interface ExportData {
    version: string;
    exportedAt: string;
    records: MingRecord[];
    notes: MingNote[];
}

type RecordWriteMode = 'create' | 'update';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRecordCategory(value: string): value is RecordCategory {
    return RECORD_CATEGORIES.some((item) => item.value === value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeStringArray(value: unknown, label: string): string[] | { error: string } {
    if (!Array.isArray(value)) {
        return { error: `${label}必须是字符串数组` };
    }

    const normalized: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') {
            return { error: `${label}必须是字符串数组` };
        }
        const trimmed = entry.trim();
        if (trimmed) {
            normalized.push(trimmed);
        }
    }

    return Array.from(new Set(normalized));
}

function normalizeRelatedChartType(value: unknown): string | null | { error: string } {
    if (value == null) {
        return null;
    }
    if (typeof value !== 'string') {
        return { error: '关联命盘类型无效' };
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeRelatedChartId(value: unknown): string | null | { error: string } {
    if (value == null) {
        return null;
    }
    if (typeof value !== 'string') {
        return { error: '关联命盘 ID 无效' };
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    if (!isValidUUID(trimmed)) {
        return { error: '关联命盘 ID 无效' };
    }
    return trimmed;
}

function normalizeRelatedChartFields(
    body: Record<string, unknown>,
    existing?: Pick<MingRecord, 'related_chart_type' | 'related_chart_id'>,
): { data: Pick<RecordInput, 'related_chart_type' | 'related_chart_id'> } | { error: string } | null {
    const hasType = hasOwn(body, 'related_chart_type');
    const hasId = hasOwn(body, 'related_chart_id');
    if (!hasType && !hasId) {
        return null;
    }

    const rawType = hasType ? normalizeRelatedChartType(body.related_chart_type) : existing?.related_chart_type ?? null;
    if (typeof rawType === 'object' && rawType && 'error' in rawType) {
        return rawType;
    }
    const rawId = hasId ? normalizeRelatedChartId(body.related_chart_id) : existing?.related_chart_id ?? null;
    if (typeof rawId === 'object' && rawId && 'error' in rawId) {
        return rawId;
    }

    let relatedChartType = rawType;
    let relatedChartId = rawId;
    if (hasType && rawType === null && !hasId) {
        relatedChartId = null;
    }
    if (hasId && rawId === null && !hasType) {
        relatedChartType = null;
    }

    if ((relatedChartType == null) !== (relatedChartId == null)) {
        return { error: '关联命盘类型和 ID 必须同时提供' };
    }

    return {
        data: {
            related_chart_type: relatedChartType,
            related_chart_id: relatedChartId,
        },
    };
}

export function normalizeRecordInput(
    input: unknown,
    mode: RecordWriteMode,
    existing?: Pick<MingRecord, 'related_chart_type' | 'related_chart_id'>,
): { data: Partial<RecordInput> } | { error: string } {
    if (!isPlainObject(input)) {
        return { error: '请求体不是合法对象' };
    }

    const data: Partial<RecordInput> = {};

    if (mode === 'create' || hasOwn(input, 'title')) {
        if (typeof input.title !== 'string' || !input.title.trim()) {
            return { error: '标题不能为空' };
        }
        data.title = input.title.trim();
    }

    if (mode === 'create' || hasOwn(input, 'content')) {
        if (input.content == null || input.content === '') {
            data.content = null;
        } else if (typeof input.content === 'string') {
            data.content = input.content;
        } else {
            return { error: '内容格式无效' };
        }
    }

    if (mode === 'create' || hasOwn(input, 'category')) {
        if (input.category == null || input.category === '') {
            data.category = 'general';
        } else if (typeof input.category === 'string' && isRecordCategory(input.category)) {
            data.category = input.category;
        } else {
            return { error: '记录分类无效' };
        }
    }

    if (mode === 'create' || hasOwn(input, 'tags')) {
        if (input.tags == null) {
            data.tags = [];
        } else {
            const tags = normalizeStringArray(input.tags, '标签');
            if (typeof tags === 'object' && !Array.isArray(tags)) {
                return tags;
            }
            data.tags = tags;
        }
    }

    if (mode === 'create' || hasOwn(input, 'event_date')) {
        if (input.event_date == null || input.event_date === '') {
            data.event_date = null;
        } else if (typeof input.event_date === 'string') {
            data.event_date = input.event_date;
        } else {
            return { error: '事件日期格式无效' };
        }
    }

    const relation = normalizeRelatedChartFields(input, existing);
    if (relation && 'error' in relation) {
        return relation;
    }
    if (relation?.data) {
        Object.assign(data, relation.data);
    } else if (mode === 'create') {
        data.related_chart_type = null;
        data.related_chart_id = null;
    }

    if (mode === 'create' || hasOwn(input, 'is_pinned')) {
        if (input.is_pinned == null) {
            data.is_pinned = false;
        } else if (typeof input.is_pinned === 'boolean') {
            data.is_pinned = input.is_pinned;
        } else {
            return { error: '置顶状态无效' };
        }
    }

    if (mode === 'update' && Object.keys(data).length === 0) {
        return { error: '没有可更新的记录字段' };
    }

    return { data };
}

// =====================================================
// 类型守卫
// =====================================================

/**
 * 验证是否为有效的 MingRecord 对象
 */
function isValidMingRecord(data: unknown): data is MingRecord {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
        typeof obj.id === 'string' &&
        typeof obj.user_id === 'string' &&
        typeof obj.title === 'string' &&
        typeof obj.created_at === 'string'
    );
}

/**
 * 验证是否为有效的 MingNote 对象
 */
function isValidMingNote(data: unknown): data is MingNote {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
        typeof obj.id === 'string' &&
        typeof obj.user_id === 'string' &&
        typeof obj.content === 'string' &&
        typeof obj.created_at === 'string'
    );
}

/**
 * 安全地将数据转换为 MingRecord
 */
function toMingRecord(data: unknown): MingRecord | null {
    return isValidMingRecord(data) ? data : null;
}

/**
 * 安全地将数据转换为 MingNote
 */
function toMingNote(data: unknown): MingNote | null {
    return isValidMingNote(data) ? data : null;
}

// =====================================================
// 记录分类配置
// =====================================================

export const RECORD_CATEGORIES: { value: RecordCategory; label: string; icon: string }[] = [
    { value: 'general', label: '通用', icon: '📝' },
    { value: 'prediction', label: '预测验证', icon: '🔮' },
    { value: 'event', label: '人生事件', icon: '📅' },
    { value: 'reflection', label: '心得反思', icon: '💭' },
];

export const NOTE_MOODS: { value: NoteMood; label: string; icon: string }[] = [
    { value: 'happy', label: '开心', icon: '😊' },
    { value: 'neutral', label: '平静', icon: '😐' },
    { value: 'sad', label: '难过', icon: '😢' },
    { value: 'anxious', label: '焦虑', icon: '😰' },
    { value: 'peaceful', label: '安宁', icon: '🧘' },
];

// =====================================================
// 记录 CRUD 操作
// =====================================================

/**
 * 获取记录列表
 */
export async function getRecords(
    filters?: RecordFilters,
    page: number = 1,
    pageSize: number = 20,
    options: { signal?: AbortSignal } = {},
): Promise<{ records: MingRecord[]; total: number }> {
    const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
    });
    if (filters?.category) query.set('category', filters.category);
    if (filters?.search) query.set('search', filters.search);
    if (filters?.startDate) query.set('startDate', filters.startDate);
    if (filters?.endDate) query.set('endDate', filters.endDate);
    if (filters?.isPinned !== undefined) query.set('isPinned', String(filters.isPinned));
    for (const tag of filters?.tags || []) {
        query.append('tag', tag);
    }

    const payload = await requestBrowserData<{ records?: unknown[]; total?: number }>(`/api/records?${query.toString()}`, { signal: options.signal }, {
        fallbackMessage: '请求失败',
    });
    const validRecords = (payload.records ?? []).filter(isValidMingRecord);
    return {
        records: validRecords,
        total: payload.total || 0,
    };
}

/**
 * 获取单条记录
 */
export async function getRecord(recordId: string, options: { signal?: AbortSignal } = {}): Promise<MingRecord> {
    const payload = await requestBrowserData<unknown>(`/api/records/${encodeURIComponent(recordId)}`, { signal: options.signal }, { fallbackMessage: '获取记录失败' });
    const record = toMingRecord(payload);
    if (!record) throw new Error('Invalid record data');
    return record;
}

/** 创建记录 */
export async function createRecord(input: RecordInput): Promise<MingRecord> {
    const payload = await requestBrowserData<unknown>('/api/records', {
        method: 'POST',
        body: JSON.stringify(input),
    }, {
        fallbackMessage: '请求失败',
    });
    const record = toMingRecord(payload);
    if (!record) throw new Error('Invalid record data');
    return record;
}

/**
 * 更新记录
 */
export async function updateRecord(recordId: string, input: Partial<RecordInput>): Promise<MingRecord> {
    const payload = await requestBrowserData<unknown>(`/api/records/${recordId}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    }, {
        fallbackMessage: '请求失败',
    });
    const record = toMingRecord(payload);
    if (!record) throw new Error('Invalid record data');
    return record;
}

/**
 * 删除记录
 */
export async function deleteRecord(recordId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    await requestBrowserData(`/api/records/${recordId}`, {
        method: 'DELETE',
        signal: options.signal,
    }, {
        fallbackMessage: '请求失败',
    });
}

/**
 * 切换记录置顶状态
 */
export async function toggleRecordPin(recordId: string, options: { signal?: AbortSignal } = {}): Promise<MingRecord> {
    const payload = await requestBrowserData<unknown>(`/api/records/${recordId}`, {
        method: 'PUT',
        signal: options.signal,
        body: JSON.stringify({ togglePin: true }),
    }, {
        fallbackMessage: '请求失败',
    });
    const record = toMingRecord(payload);
    if (!record) throw new Error('Invalid record data');
    return record;
}

// =====================================================
// 小记 CRUD 操作
// =====================================================

/**
 * 获取某日的小记
 */
export async function getNotesByDate(date: string, options: { signal?: AbortSignal } = {}): Promise<MingNote[]> {
    const payload = await requestBrowserData<{ notes?: unknown[] }>(`/api/notes?date=${encodeURIComponent(date)}`, { signal: options.signal }, {
        fallbackMessage: '请求失败',
    });
    return (payload.notes ?? []).filter(isValidMingNote);
}

/**
 * 创建小记
 */
export async function createNote(input: NoteInput): Promise<MingNote> {
    const payload = await requestBrowserData<unknown>('/api/notes', {
        method: 'POST',
        body: JSON.stringify(input),
    }, {
        fallbackMessage: '请求失败',
    });
    const note = toMingNote(payload);
    if (!note) throw new Error('Invalid note data');
    return note;
}

/**
 * 删除小记
 */
export async function deleteNote(noteId: string): Promise<void> {
    await requestBrowserData(`/api/notes/${noteId}`, {
        method: 'DELETE',
    }, {
        fallbackMessage: '请求失败',
    });
}

// =====================================================
// 导入导出功能
// =====================================================

/**
 * 导出所有数据
 */
export async function exportData(): Promise<ExportData> {
    const payload = await requestBrowserData<ExportData>('/api/records/export', {
        method: 'GET',
    }, {
        fallbackMessage: '请求失败',
    });
    return {
        ...payload,
        records: (payload.records ?? []).filter(isValidMingRecord),
        notes: (payload.notes ?? []).filter(isValidMingNote),
    };
}

/**
 * 导入数据（覆盖模式）
 */
export async function importData(
    data: ExportData,
): Promise<{ message?: string; recordsImported: number; notesImported: number }> {
    const payload = await requestBrowserData<{
        message?: string;
        recordsImported?: number;
        notesImported?: number;
    }>('/api/records/import', {
        method: 'POST',
        body: JSON.stringify(data),
    }, {
        fallbackMessage: '请求失败',
    });

    const recordsImported = Number(payload.recordsImported ?? NaN);
    const notesImported = Number(payload.notesImported ?? NaN);
    if (!Number.isFinite(recordsImported) || !Number.isFinite(notesImported)) {
        throw new Error('导入结果无效');
    }

    return {
        message: payload.message,
        recordsImported,
        notesImported,
    };
}

/**
 * 备份数据（下载JSON文件）
 */
export function downloadExportData(data: ExportData, filename?: string): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `mingai-records-${toLocalDateKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 用户本地的日期（YYYY-MM-DD）。
 *
 * 小记按用户当天归档；toISOString() 取的是 UTC 日期，北京时间 0–8 点会落到前一天。
 */
export function toLocalDateKey(date: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 解析导入文件内容。只检查导出文件的外层结构，逐条字段由导入接口校验。
 */
export function parseImportData(text: string): ExportData {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('文件解析失败，请确保文件是有效的JSON格式');
    }
    if (!isPlainObject(data) || typeof data.version !== 'string' || !data.version
        || !Array.isArray(data.records) || !Array.isArray(data.notes)) {
        throw new Error('导入数据格式无效，请选择从命理记录导出的 JSON 文件');
    }
    return data as unknown as ExportData;
}

/**
 * 读取导入文件
 */
export function readImportFile(file: File): Promise<ExportData> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                resolve(parseImportData(String(e.target?.result ?? '')));
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsText(file);
    });
}
