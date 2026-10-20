'use client';
// 需要命盘库查询、保存中的状态与 Toast

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import type { AgentToolPart } from '@/lib/agent/tool-presentation';
import { findSavedAgentChart, getAgentChartSave, getSavedChartHref } from '@/lib/agent/chart-save';
import { useChartMutation, useUserCharts } from '@/lib/hooks/useUserCharts';
import { createSavedChart } from '@/lib/user/charts-client';
import { useToast } from '@/components/ui/Toast';

/**
 * 盘面工具栏的「保存命盘」：和八字、紫微结果页一样由用户决定是否存入命盘库。已在库里的同一张盘（无论在哪一页保存）
 * 显示为已保存，点开即是命盘页；库里删除后又回到可保存。
 */
export function AgentChartSave({ tool, userId }: { tool: AgentToolPart; userId: string | null }) {
    const save = useMemo(() => getAgentChartSave(tool), [tool]);
    const library = useUserCharts(userId, { enabled: save !== null });
    const mutation = useChartMutation(userId);
    const { showToast } = useToast();
    // 保存成功到命盘库重新读回之间，按刚保存的 ID 显示，避免按钮闪回「保存」被再点一次。
    const [created, setCreated] = useState<string | null>(null);
    if (!save || !userId) return null;
    const savedId = findSavedAgentChart(library.data, save)?.id ?? (library.isFetching ? created : null);
    if (savedId) return <Link className="agent-board-tool is-saved" href={getSavedChartHref(save.type, savedId)}
        aria-label="已保存到我的命盘，打开命盘页" title="已保存到我的命盘，打开命盘页"><BookmarkCheck size={14} aria-hidden="true" /></Link>;
    return <button type="button" className="agent-board-tool" aria-label="保存命盘" title="保存到我的命盘"
        disabled={mutation.pending || library.isPending}
        onClick={() => void mutation.run(scope => createSavedChart(save.type, save.payload, scope), id => {
            setCreated(id);
            showToast('success', '已保存到我的命盘');
        }, error => showToast('error', error instanceof Error ? error.message : '保存命盘失败'))}>
        <BookmarkPlus size={14} aria-hidden="true" />
    </button>;
}
