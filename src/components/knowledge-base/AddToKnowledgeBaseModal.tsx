/**
 * 添加到知识库弹窗组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState, useEffect, useCallback)
 * - 有弹窗交互和表单提交功能
 */
'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { X } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import {
    createKnowledgeBase,
    ingestKnowledgeBaseSource,
    listKnowledgeBases,
    type KnowledgeBaseSummary,
} from '@/lib/knowledge-base/browser-client';

export function AddToKnowledgeBaseModal({
    open,
    onClose,
    onSuccess,
    sourceTitle,
    sourceType,
    sourceId,
    sourceMeta,
}: {
    open: boolean;
    onClose: () => void;
    onSuccess?: (payload: { sourceType: string; sourceId: string; kbId: string }) => void;
    sourceTitle: string;
    sourceType: string;
    sourceId: string;
    sourceMeta?: Record<string, unknown>;
}) {
    const id = useId();
    const [kbLoading, setKbLoading] = useState(false);
    const [kbSaving, setKbSaving] = useState(false);
    const [kbError, setKbError] = useState<string | null>(null);
    const [kbList, setKbList] = useState<KnowledgeBaseSummary[]>([]);
    const [kbSelectedId, setKbSelectedId] = useState<string>('');
    const [kbNewName, setKbNewName] = useState('');
    const { showToast } = useToast();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();

    const loadKnowledgeBases = useCallback(async () => {
        setKbLoading(true);
        setKbError(null);
        try {
            const list = await listKnowledgeBases();
            setKbList(list);
            if (!kbSelectedId && list.length) {
                setKbSelectedId(list[0].id);
            }
        } catch (loadError) {
            setKbError(loadError instanceof Error ? loadError.message : '获取知识库失败');
            setKbList([]);
        } finally {
            setKbLoading(false);
        }
    }, [kbSelectedId]);

    useEffect(() => {
        if (!open || !knowledgeBaseEnabled) return;
        void loadKnowledgeBases();
    }, [knowledgeBaseEnabled, loadKnowledgeBases, open]);

    const handleCreateKnowledgeBase = useCallback(async () => {
        const name = kbNewName.trim();
        if (!name) {
            setKbError('请输入知识库名称');
            return;
        }
        setKbSaving(true);
        setKbError(null);
        try {
            const created = await createKnowledgeBase({ name });
            setKbNewName('');
            setKbSelectedId(created.id);
            await loadKnowledgeBases();
        } catch (createError) {
            setKbError(createError instanceof Error ? createError.message : '创建知识库失败');
        } finally {
            setKbSaving(false);
        }
    }, [kbNewName, loadKnowledgeBases]);

    const handleIngest = useCallback(async () => {
        if (!kbSelectedId) {
            setKbError('请选择知识库');
            return;
        }
        setKbSaving(true);
        setKbError(null);
        try {
            await ingestKnowledgeBaseSource({
                kbId: kbSelectedId,
                sourceType,
                sourceId,
                sourceMeta,
            });
            onSuccess?.({ sourceType, sourceId, kbId: kbSelectedId });
            showToast('success', '已加入知识库');
            onClose();
        } catch (ingestError) {
            const message = ingestError instanceof Error ? ingestError.message : '加入知识库失败';
            setKbError(message);
            showToast('error', message);
        } finally {
            setKbSaving(false);
        }
    }, [kbSelectedId, onClose, onSuccess, showToast, sourceId, sourceMeta, sourceType]);

    if (!open || !knowledgeBaseEnabled) return null;

    return (
        <Dialog bare open={open} onClose={onClose} busy={kbSaving} labelledBy={id}>
                <div className="p-4 sm:p-6 border-b border-border/50 flex items-center justify-between">
                    <div className="min-w-0">
                        <h2 id={id} className="text-base font-semibold truncate">加入知识库</h2>
                        <div className="text-xs text-foreground-secondary truncate">{sourceTitle}</div>
                    </div>
                    <IconButton
                        label="关闭"
                        onClick={onClose}
                        disabled={kbSaving}
                    >
                        <X className="w-4 h-4" aria-hidden="true" />
                    </IconButton>
                </div>

                <div className="p-4 sm:p-6 space-y-4">
                    {kbLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <SoundWaveLoader variant="inline" />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {kbList.length === 0 ? (
                                <div className="text-sm text-foreground-secondary">你还没有知识库，先创建一个。</div>
                            ) : (
                                <RadioGroup
                                    aria-label="选择知识库"
                                    value={kbSelectedId ?? ''}
                                    onChange={setKbSelectedId}
                                    options={kbList.map(kb => ({ value: kb.id, label: kb.name, description: kb.description || '知识库' }))}
                                    className="max-h-56 space-y-2 overflow-auto pr-1"
                                    optionClassName={(_, checked) => `items-start rounded-xl border p-3 ${checked ? 'border-success/40 bg-success/5' : 'border-border hover:bg-background-secondary'}`}
                                />
                            )}
                        </div>
                    )}

                    {!kbLoading && kbList.length === 0 && (
                        <div className="border-t border-border/50 pt-4 space-y-2">
                            <div className="text-sm font-medium">创建新知识库</div>
                            <div className="flex items-center gap-2">
                                <Input
                                    value={kbNewName}
                                    onChange={(e) => setKbNewName(e.target.value)}
                                    className="flex-1"
                                    placeholder="例如：我的命理笔记"
                                />
                                <Button
                                    variant="secondary"
                                    onClick={handleCreateKnowledgeBase}
                                    disabled={kbSaving || !kbNewName.trim()}
                                >
                                    创建
                                </Button>
                            </div>
                        </div>
                    )}

                    {kbError && (
                        <div role="alert" className="text-sm text-danger">{kbError}</div>
                    )}
                </div>

                <div className="p-4 sm:p-6 border-t border-border/50 flex items-center justify-end gap-2">
                    <Button variant="secondary" onClick={onClose} disabled={kbSaving}>
                        取消
                    </Button>
                    <Button
                        onClick={handleIngest}
                        loading={kbSaving}
                        loadingText="加入中"
                        disabled={kbLoading || !kbSelectedId}
                    >
                        加入
                    </Button>
                </div>
        </Dialog>
    );
}
