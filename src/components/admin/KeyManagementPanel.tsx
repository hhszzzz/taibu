/**
 * 激活码管理面板
 *
 * 管理员批量创建、查看、复制、删除激活码。
 *
 * 'use client' 标记说明：
 * - 需要 useState / useEffect 加载列表、维护批量创建表单，并调用剪贴板 API
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Plus, Trash2, X } from 'lucide-react';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { requestBrowserData } from '@/lib/browser-api';
import { formatShortDate } from '@/lib/short-date';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

interface ActivationKey {
    id: string;
    key_code: string;
    key_type: 'membership' | 'credits';
    membership_type: 'plus' | 'pro' | null;
    credits_amount: number | null;
    is_used: boolean;
    used_by: string | null;
    used_at: string | null;
    created_at: string;
}

type CreateKeyType = 'plus' | 'pro' | 'credits';
type KeyFilter = 'all' | 'unused' | 'used';

const CREATE_TYPE_OPTIONS: Array<{ value: CreateKeyType; label: string }> = [
    { value: 'plus', label: 'Plus 会员' },
    { value: 'pro', label: 'Pro 会员' },
    { value: 'credits', label: '积分发放' },
];

const FILTERS: Array<{ id: KeyFilter; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'unused', label: '未使用' },
    { id: 'used', label: '已使用' },
];

const DEFAULT_CREATE_TYPE: CreateKeyType = 'plus';
const DEFAULT_COUNT = '1';
const DEFAULT_CREDITS = '10';
const MAX_COUNT = 100;
const MAX_CREDITS = 1000;
const COPIED_RESET_MS = 2000;
const CARD = 'rounded-[14px] border border-border bg-surface';
const TH = 'px-3 py-3 text-left text-xs font-medium text-foreground-tertiary';

/** 只接受 min–max 之间的整数；空串、小数和超范围都返回 null。 */
function parseIntegerInput(value: string, min: number, max: number): number | null {
    if (!/^\d+$/u.test(value.trim())) return null;
    const parsed = Number(value);
    return parsed >= min && parsed <= max ? parsed : null;
}

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function getKeyTypeLabel(key: ActivationKey) {
    if (key.key_type === 'credits') return `积分 · ${key.credits_amount ?? 0}`;
    return key.membership_type === 'pro' ? 'Pro 会员' : 'Plus 会员';
}

export function KeyManagementPanel() {
    const { showToast } = useToast();
    const [keys, setKeys] = useState<ActivationKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [filter, setFilter] = useState<KeyFilter>('all');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ActivationKey | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [createdCodes, setCreatedCodes] = useState<string[] | null>(null);

    const [formOpen, setFormOpen] = useState(false);
    const [createType, setCreateType] = useState<CreateKeyType>(DEFAULT_CREATE_TYPE);
    const [countInput, setCountInput] = useState(DEFAULT_COUNT);
    const [creditsInput, setCreditsInput] = useState(DEFAULT_CREDITS);
    const [creating, setCreating] = useState(false);
    useUnsavedSettingsGuard(formOpen && (createType !== DEFAULT_CREATE_TYPE || countInput !== DEFAULT_COUNT || creditsInput !== DEFAULT_CREDITS));

    // 只采用最近一次请求的结果，避免创建后的刷新被更早发出的请求覆盖。
    const loadSeqRef = useRef(0);
    const copiedTimerRef = useRef<number | null>(null);

    const loadKeys = useCallback(async () => {
        const seq = ++loadSeqRef.current;
        try {
            // 接口返回 { success, data }，requestBrowserData 已经取出 data，这里拿到的就是数组。
            const data = await requestBrowserData<ActivationKey[]>(
                '/api/activation-keys',
                { method: 'GET' },
                { fallbackMessage: '获取激活码失败' },
            );
            if (seq !== loadSeqRef.current) return;
            setKeys(Array.isArray(data) ? data : []);
            setLoadError(null);
        } catch (error) {
            if (seq !== loadSeqRef.current) return;
            setLoadError(getErrorMessage(error, '获取激活码失败'));
        } finally {
            if (seq === loadSeqRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadKeys();
    }, [loadKeys]);

    useEffect(() => () => {
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    }, []);

    const counts = useMemo(() => {
        const used = keys.filter(key => key.is_used).length;
        return { all: keys.length, used, unused: keys.length - used } satisfies Record<KeyFilter, number>;
    }, [keys]);

    const visibleKeys = useMemo(
        () => (filter === 'all' ? keys : keys.filter(key => key.is_used === (filter === 'used'))),
        [keys, filter],
    );

    const count = parseIntegerInput(countInput, 1, MAX_COUNT);
    const credits = parseIntegerInput(creditsInput, 1, MAX_CREDITS);
    const formValid = count !== null && (createType !== 'credits' || credits !== null);

    const retryLoad = () => {
        setLoading(true);
        setLoadError(null);
        void loadKeys();
    };

    const closeForm = () => {
        setFormOpen(false);
        setCreateType(DEFAULT_CREATE_TYPE);
        setCountInput(DEFAULT_COUNT);
        setCreditsInput(DEFAULT_CREDITS);
    };

    const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!formValid || creating) return;

        setCreating(true);
        try {
            const body = createType === 'credits'
                ? { action: 'create', count, keyType: 'credits', creditsAmount: credits }
                : { action: 'create', count, keyType: 'membership', membershipType: createType };
            // 失败时接口返回 { success: false, error }，requestBrowserData 会带着服务端原因抛出。
            const data = await requestBrowserData<{ success?: boolean; keys?: string[]; error?: string }>(
                '/api/activation-keys',
                { method: 'POST', body: JSON.stringify(body) },
                { fallbackMessage: '创建失败' },
            );
            if (!data.success) {
                showToast('error', data.error || '创建失败');
                return;
            }
            const codes = data.keys ?? [];
            setCreatedCodes(codes);
            showToast('success', `已生成 ${codes.length} 个激活码`);
            closeForm();
            setFilter('all');
            await loadKeys();
        } catch (error) {
            showToast('error', getErrorMessage(error, '创建失败'));
        } finally {
            setCreating(false);
        }
    };

    const confirmDelete = async () => {
        const target = deleteTarget;
        if (!target || deleting) return;

        setDeleting(true);
        try {
            const data = await requestBrowserData<{ success?: boolean }>(
                `/api/activation-keys?id=${encodeURIComponent(target.id)}`,
                { method: 'DELETE' },
                { fallbackMessage: '删除失败' },
            );
            if (!data.success) {
                showToast('error', '删除失败');
                return;
            }
            setKeys(current => current.filter(key => key.id !== target.id));
            setDeleteTarget(null);
            showToast('success', '激活码已删除');
        } catch (error) {
            showToast('error', getErrorMessage(error, '删除失败'));
        } finally {
            setDeleting(false);
        }
    };

    const copyText = async (text: string, copiedKeyId: string | null, failureMessage: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            showToast('error', failureMessage);
            return false;
        }
        setCopiedId(copiedKeyId);
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(() => setCopiedId(null), COPIED_RESET_MS);
        return true;
    };

    const copyCreatedCodes = async () => {
        if (!createdCodes?.length) return;
        if (await copyText(createdCodes.join('\n'), null, '复制失败，请在列表里逐个复制')) {
            showToast('success', `已复制 ${createdCodes.length} 个激活码`);
        }
    };

    if (loading) {
        return <SoundWaveLoader variant="block" />;
    }

    return (
        <div className="flex flex-col gap-4">
            {loadError ? (
                <div role="alert" className="settings-alert">
                    {loadError}
                    <button type="button" onClick={retryLoad}>重试</button>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="按状态筛选" className="flex flex-wrap items-center gap-1.5">
                    {FILTERS.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={filter === id}
                            onClick={() => setFilter(id)}
                            className="settings-filter"
                        >
                            {label} <span className="tabular-nums">{counts[id]}</span>
                        </button>
                    ))}
                </div>
                {formOpen ? null : (
                    <button type="button" onClick={() => setFormOpen(true)} className="settings-button settings-button-primary">
                        <Plus aria-hidden="true" className="h-4 w-4" />
                        批量创建
                    </button>
                )}
            </div>

            {formOpen ? (
                <form
                    onSubmit={handleCreate}
                    aria-label="批量创建激活码"
                    className={`grid grid-cols-[repeat(auto-fit,minmax(11.25rem,1fr))] gap-4 p-5 ${CARD}`}
                >
                    <label className="settings-field">
                        类型
                        <select
                            value={createType}
                            onChange={(event) => setCreateType(event.target.value as CreateKeyType)}
                            className="settings-select settings-input-lg w-full"
                        >
                            {CREATE_TYPE_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    {createType === 'credits' ? (
                        <label className="settings-field">
                            每个积分数量
                            <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={MAX_CREDITS}
                                step={1}
                                value={creditsInput}
                                onChange={(event) => setCreditsInput(event.target.value)}
                                aria-invalid={credits === null}
                                className="settings-input settings-input-lg w-full"
                            />
                        </label>
                    ) : null}
                    <label className="settings-field">
                        生成数量
                        <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={MAX_COUNT}
                            step={1}
                            value={countInput}
                            onChange={(event) => setCountInput(event.target.value)}
                            aria-invalid={count === null}
                            className="settings-input settings-input-lg w-full"
                        />
                    </label>
                    <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
                        <p className="settings-help">
                            {createType === 'credits'
                                ? `单次最多 ${MAX_COUNT} 个，每个 1–${MAX_CREDITS} 积分。`
                                : `单次最多 ${MAX_COUNT} 个。`}
                        </p>
                        <div className="flex gap-2">
                            <button type="button" onClick={closeForm} disabled={creating} className="settings-button settings-button-ghost">取消</button>
                            <button type="submit" disabled={!formValid || creating} className="settings-button settings-button-primary">
                                {creating ? '生成中…' : '生成'}
                            </button>
                        </div>
                    </div>
                </form>
            ) : null}

            {createdCodes && createdCodes.length > 0 ? (
                <div role="status" className={`flex flex-wrap items-center justify-between gap-2 py-2.5 pl-5 pr-2.5 ${CARD}`}>
                    <span className="text-sm text-foreground">已生成 {createdCodes.length} 个激活码</span>
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={() => { void copyCreatedCodes(); }} className="settings-button settings-button-compact">
                            <Copy aria-hidden="true" className="h-4 w-4" />
                            复制全部
                        </button>
                        <button type="button" onClick={() => setCreatedCodes(null)} aria-label="关闭提示" className="settings-icon-button">
                            <X aria-hidden="true" className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            ) : null}

            {visibleKeys.length > 0 ? (
                // relative 让表头里 sr-only 的绝对定位文字也被滚动容器裁剪，否则手机上会撑宽整页。
                <div className={`relative overflow-x-auto ${CARD}`}>
                    <table className="w-full min-w-[35rem] border-collapse">
                        <thead>
                            <tr className="border-b border-border">
                                <th scope="col" className={`${TH} pl-5 pr-4`}>激活码</th>
                                <th scope="col" className={TH}>类型</th>
                                <th scope="col" className={TH}>创建</th>
                                <th scope="col" className={TH}>状态</th>
                                <th scope="col" className="py-3 pr-3"><span className="sr-only">操作</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleKeys.map((key) => {
                                const copied = copiedId === key.id;
                                return (
                                    <tr key={key.id} className="border-b border-border last:border-b-0">
                                        <th scope="row" className={`select-all whitespace-nowrap py-3.5 pl-5 pr-4 text-left font-mono text-[13px] font-normal ${key.is_used ? 'text-foreground-tertiary' : 'text-foreground'}`}>
                                            {key.key_code}
                                        </th>
                                        <td className="whitespace-nowrap px-3 py-3.5 text-sm text-foreground-secondary">{getKeyTypeLabel(key)}</td>
                                        <td className="whitespace-nowrap px-3 py-3.5 text-[13px] tabular-nums text-foreground-secondary">{formatShortDate(key.created_at)}</td>
                                        <td className="whitespace-nowrap px-3 py-3.5">
                                            {key.is_used ? (
                                                <span className="text-[13px] tabular-nums text-foreground-tertiary">
                                                    已使用{key.used_at ? ` · ${formatShortDate(key.used_at)}` : ''}
                                                </span>
                                            ) : (
                                                <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">未使用</span>
                                            )}
                                        </td>
                                        <td className="py-1.5 pr-3">
                                            <div className="flex justify-end gap-0.5">
                                                {key.is_used ? null : (
                                                    <button
                                                        type="button"
                                                        onClick={() => { void copyText(key.key_code, key.id, '复制失败，请手动选择激活码'); }}
                                                        aria-label={`复制激活码 ${key.key_code}`}
                                                        title={copied ? '已复制' : '复制'}
                                                        className={`settings-icon-button ${copied ? 'text-success' : ''}`}
                                                    >
                                                        {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setDeleteTarget(key)}
                                                    aria-label={`删除激活码 ${key.key_code}`}
                                                    title="删除"
                                                    className="settings-icon-button settings-icon-button-danger"
                                                >
                                                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : loadError ? null : (
                <div className={`flex flex-col items-center gap-1.5 px-6 py-12 text-center ${CARD}`}>
                    <p className="text-[15px] text-foreground">{filter === 'all' ? '还没有激活码' : `没有${filter === 'used' ? '已使用' : '未使用'}的激活码`}</p>
                    {filter === 'all' ? <p className="settings-help">点「批量创建」生成会员或积分激活码。</p> : null}
                </div>
            )}

            <span role="status" className="sr-only">{copiedId ? '已复制激活码' : ''}</span>

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => { if (!deleting) setDeleteTarget(null); }}
                onConfirm={confirmDelete}
                title="删除激活码"
                description={!deleteTarget ? '' : deleteTarget.is_used
                    ? `确定删除「${deleteTarget.key_code}」的记录吗？已兑换的会员或积分不受影响，此操作无法撤销。`
                    : `确定删除「${deleteTarget.key_code}」吗？删除后这个激活码将无法再兑换，此操作无法撤销。`}
                confirmText="确认删除"
                variant="danger"
                loading={deleting}
            />
        </div>
    );
}
