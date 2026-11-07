/**
 * 定时任务页：列出当前账号的任务、下一次运行与最近状态，支持新建、编辑、
 * 暂停/恢复、立即运行、运行历史和打开绑定对话。
 *
 * 'use client' 标记说明：
 * - 列表、编辑草稿、运行历史与删除确认都在浏览器完成
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, History, Pause, Play, Plus, RotateCw, Trash2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { ScheduleEditor } from '@/components/scheduled/ScheduleEditor';
import { agentScheduleClient, type AgentScheduleAllowance } from '@/lib/agent/schedules/client';
import {
  AGENT_SCHEDULE_RUN_STATUS_LABELS, AGENT_SCHEDULE_SKIP_REASON_LABELS, AGENT_SCHEDULE_STATUS_LABELS,
  describeAgentScheduleCadence, previewAgentSchedulePrompt, formatAgentScheduleMoment,
  type AgentScheduleRunView, type AgentScheduleStatus, type AgentScheduleTemplate, type AgentScheduleView,
} from '@/lib/agent/schedules/config';
import { conversationHref } from '@/lib/chat/conversation-href';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; schedules: AgentScheduleView[]; allowance: AgentScheduleAllowance };

type EditorState = { schedule?: AgentScheduleView; template?: AgentScheduleTemplate } | null;
type HistoryState = { schedule: AgentScheduleView; loading: boolean; runs: AgentScheduleRunView[]; error: string | null } | null;

function statusOf(schedule: AgentScheduleView): AgentScheduleStatus {
  return schedule.enabled ? schedule.lastStatus ?? 'pending' : 'paused';
}

export function ScheduledTasksPage() {
  const { user, loading: sessionLoading } = useSessionSafe();
  const userId = user?.id ?? null;
  const { showToast } = useToast();
  const client = useMemo(() => agentScheduleClient(userId ?? undefined), [userId]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleting, setDeleting] = useState<AgentScheduleView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [history, setHistory] = useState<HistoryState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!userId) { setState({ status: 'ready', schedules: [], allowance: { limit: 0, used: 0 } }); return; }
    const controller = new AbortController();
    setState({ status: 'loading' });
    client.list(controller.signal).then(
      listing => { if (!controller.signal.aborted) setState({ status: 'ready', ...listing }); },
      error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : '读取定时任务失败' }); },
    );
    return () => controller.abort();
  }, [client, reload, sessionLoading, userId]);

  const refresh = useCallback(() => setReload(value => value + 1), []);

  const applySchedule = (schedule: AgentScheduleView) => setState(current => current.status === 'ready'
    ? { ...current, schedules: current.schedules.map(item => item.id === schedule.id ? schedule : item) }
    : current);

  const toggle = async (schedule: AgentScheduleView) => {
    setBusyId(schedule.id);
    try {
      const saved = await client.update(schedule.id, { enabled: !schedule.enabled });
      applySchedule(saved);
      showToast('success', saved.enabled ? '定时任务已恢复' : '定时任务已暂停');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '更新失败');
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (schedule: AgentScheduleView) => {
    setBusyId(schedule.id);
    try {
      const run = await client.run(schedule.id);
      if (run.status === 'skipped') {
        showToast('error', AGENT_SCHEDULE_SKIP_REASON_LABELS[run.skipReason ?? ''] ?? '本次运行已跳过');
      } else if (run.status === 'failed') {
        showToast('error', run.error || '本次运行未完成');
      } else {
        showToast('success', '已开始运行，结果会追加到绑定对话');
      }
      refresh();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '运行失败');
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (schedule: AgentScheduleView) => {
    setHistory({ schedule, loading: true, runs: [], error: null });
    try {
      const runs = await client.runs(schedule.id);
      setHistory(current => current && current.schedule.id === schedule.id ? { ...current, loading: false, runs } : current);
    } catch (error) {
      setHistory(current => current && current.schedule.id === schedule.id
        ? { ...current, loading: false, error: error instanceof Error ? error.message : '读取运行历史失败' } : current);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await client.remove(deleting.id);
      setDeleting(null);
      showToast('success', '定时任务已删除');
      refresh();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleteBusy(false);
    }
  };

  if (sessionLoading) return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
  if (!userId) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-display text-2xl text-foreground">定时任务</h1>
        <p className="mt-3 text-sm text-foreground-secondary">登录后可以创建定时任务，让 Agent 按你的时间表在固定对话里继续工作。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-foreground">定时任务</h1>
          <p className="mt-1 text-sm text-foreground-secondary">按每天、每周、每月或固定间隔让 Agent 在固定对话里追加一轮；始终使用平台模型，每次运行按用量扣费。</p>
          {state.status === 'ready' ? (
            <p className="mt-1 text-xs text-foreground-tertiary">每人最多 {state.allowance.limit} 个，已用 {state.allowance.used} 个。</p>
          ) : null}
        </div>
        <Button
          disabled={state.status !== 'ready' || state.allowance.used >= state.allowance.limit}
          onClick={() => setEditor({ template: 'custom' })}>
          <Plus size={16} aria-hidden="true" />新建定时任务
        </Button>
      </header>

      {state.status === 'loading' ? <div className="flex min-h-[200px] items-center justify-center"><SoundWaveLoader variant="inline" /></div> : null}
      {state.status === 'error' ? (
        <div role="alert" className="settings-alert">
          <span className="min-w-0 flex-1">{state.message}</span>
          <Button variant="ghost" size="xs" onClick={refresh}>重试</Button>
        </div>
      ) : null}
      {state.status === 'ready' && state.schedules.length === 0 ? (
        <div className="rounded-2xl border-[0.5px] border-border bg-background-secondary px-5 py-10 text-center">
          <p className="text-sm text-foreground-secondary">还没有定时任务。可以从「每日早报」开始，或写一条自己的提示词。</p>
          <Button variant="secondary" className="mt-4" onClick={() => setEditor({ template: 'daily_briefing' })}>使用每日早报模板</Button>
        </div>
      ) : null}
      {state.status === 'ready' && state.schedules.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="定时任务列表">
          {state.schedules.map(schedule => {
            const status = statusOf(schedule);
            return (
              <li key={schedule.id} data-schedule-id={schedule.id} className="rounded-2xl border-[0.5px] border-border bg-background-secondary px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-display text-lg text-foreground">{schedule.name}</h2>
                      {schedule.template === 'daily_briefing' ? <span className="rounded-md bg-accent-light px-1.5 py-0.5 text-xs text-accent-hover">每日早报</span> : null}
                      <span className="text-xs text-foreground-tertiary">{AGENT_SCHEDULE_STATUS_LABELS[status]}</span>
                      {schedule.consecutiveFailures > 0 ? <span className="text-xs text-danger">连续失败 {schedule.consecutiveFailures} 次</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-foreground-secondary">{describeAgentScheduleCadence(schedule.cadence)} · {schedule.timezone}</p>
                    <p className="mt-1 text-xs text-foreground-tertiary">
                      {schedule.enabled
                        ? `下一次：${formatAgentScheduleMoment(schedule.nextRunAt, schedule.timezone) || '待计算'}`
                        : schedule.conversationId ? '已暂停' : '绑定的对话已删除，请删除后重建'}
                      {schedule.lastRunAt ? ` · 上次：${formatAgentScheduleMoment(schedule.lastRunAt, schedule.timezone)}` : ''}
                    </p>
                    <p className="mt-2 line-clamp-2 text-xs text-foreground-tertiary">{previewAgentSchedulePrompt(schedule.prompt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {schedule.conversationId ? (
                      <Link href={conversationHref({ id: schedule.conversationId, agentNotice: true })} className={buttonVariants({ variant: 'ghost' })}>打开对话</Link>
                    ) : null}
                    <Button variant="ghost" disabled={busyId === schedule.id} onClick={() => { void toggle(schedule); }}>
                      {schedule.enabled ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                      {schedule.enabled ? '暂停' : '恢复'}
                    </Button>
                    <Button variant="ghost" disabled={busyId === schedule.id || !schedule.conversationId} onClick={() => { void runNow(schedule); }}>
                      <RotateCw size={14} aria-hidden="true" />立即运行
                    </Button>
                    <Button variant="ghost" onClick={() => { void openHistory(schedule); }}>
                      <History size={14} aria-hidden="true" />运行历史
                    </Button>
                    <Button variant="ghost" onClick={() => setEditor({ schedule })}>编辑</Button>
                    <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setDeleting(schedule)}>
                      <Trash2 size={14} aria-hidden="true" />删除
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {history ? (
        <section aria-label="运行历史" className="rounded-2xl border-[0.5px] border-border bg-background-secondary px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg text-foreground">运行历史 · {history.schedule.name}</h2>
            <Button variant="ghost" onClick={() => setHistory(null)}>关闭</Button>
          </div>
          {history.loading ? <div className="py-6 text-center"><SoundWaveLoader variant="inline" /></div> : null}
          {history.error ? <p role="alert" className="mt-3 text-sm text-danger">{history.error}</p> : null}
          {!history.loading && !history.error ? (
            history.runs.length === 0 ? <p className="mt-3 text-sm text-foreground-tertiary">还没有运行记录。</p> : (
              <table className="mt-3 w-full text-left text-sm">
                <thead><tr className="text-xs text-foreground-tertiary"><th className="py-1">计划时间</th><th>状态</th><th>说明</th></tr></thead>
                <tbody>
                  {history.runs.map(run => (
                    <tr key={run.id} className="border-t border-border/60">
                      <td className="py-1.5">{formatAgentScheduleMoment(run.scheduledFor, history.schedule.timezone)}</td>
                      <td>{AGENT_SCHEDULE_RUN_STATUS_LABELS[run.status]}</td>
                      <td className="text-foreground-tertiary">{run.error || (run.skipReason ? AGENT_SCHEDULE_SKIP_REASON_LABELS[run.skipReason] ?? run.skipReason : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : null}
        </section>
      ) : null}

      {editor ? (
        <ScheduleEditor key={editor.schedule?.id ?? `new-${editor.template ?? 'custom'}`} open userId={userId}
          schedule={editor.schedule} template={editor.schedule ? undefined : editor.template}
          onClose={() => setEditor(null)} onSaved={refresh} />
      ) : null}
      <ConfirmDialog isOpen={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => { void confirmDelete(); }}
        title="删除定时任务" description={`删除「${deleting?.name ?? ''}」后不再自动运行，已生成的对话会保留。`}
        confirmText="删除" loading={deleteBusy} />
      <p className="flex items-center gap-1.5 text-xs text-foreground-tertiary"><Clock size={13} aria-hidden="true" />定时任务的对话会出现在最近使用里，并带有时钟标记。</p>
    </div>
  );
}
