/**
 * 新建 / 编辑定时任务。模板只决定初始内容：每日早报填入黄历与默认命盘的提示词，
 * 之后时间、时区、执行内容和模型都可以改。
 *
 * 'use client' 标记说明：
 * - 表单草稿、保存状态、模型与命盘选择都在浏览器完成
 */
'use client';

import { useId, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import type { AIReasoningEffort } from '@/types';
import type { AgentCollaborator } from '@/lib/chat/model-settings';
import { useAvailableModels } from '@/lib/hooks/useAvailableModels';
import { useUserCharts } from '@/lib/hooks/useUserCharts';
import { listSavedBaziCharts } from '@/lib/user/charts-client';
import { agentScheduleClient } from '@/lib/agent/schedules/client';
import {
  AGENT_SCHEDULE_INTERVAL_HOURS_MAX, AGENT_SCHEDULE_NAME_MAX, AGENT_SCHEDULE_PROMPT_MAX,
  AGENT_SCHEDULE_WEEKDAY_LABELS, dailyBriefingPrompt, defaultAgentScheduleOptions,
  parseAgentScheduleInput, validAgentScheduleTimeZone,
  type AgentScheduleCadence, type AgentScheduleKind, type AgentScheduleOptions, type AgentScheduleTemplate,
  type AgentScheduleView,
} from '@/lib/agent/schedules/config';

type Draft = {
  name: string;
  template: AgentScheduleTemplate;
  prompt: string;
  kind: AgentScheduleKind;
  time: string;
  weekdays: number[];
  monthDay: string;
  intervalHours: string;
  timezone: string;
  model: string;
  reasoning: boolean;
  reasoningEffort: AIReasoningEffort | null;
  webEnabled: boolean;
  baziChartId: string;
  notify: boolean;
  knowledgeBaseIds: string[];
  collaborators: AgentCollaborator[];
};

const CUSTOM: AgentScheduleTemplate = 'custom';
const BRIEFING: AgentScheduleTemplate = 'daily_briefing';

function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'; } catch { return 'Asia/Shanghai'; }
}

function timeZones(current: string): string[] {
  let supported: string[] = [];
  try { supported = Intl.supportedValuesOf?.('timeZone') ?? []; } catch { supported = []; }
  return [...new Set([current, 'Asia/Shanghai', 'UTC', ...supported])].filter(validAgentScheduleTimeZone);
}

function draftFromSchedule(schedule: AgentScheduleView): Draft {
  const cadence = schedule.cadence;
  return {
    name: schedule.name,
    template: schedule.template,
    prompt: schedule.prompt,
    kind: cadence.kind,
    time: cadence.time,
    weekdays: cadence.kind === 'weekly' ? cadence.weekdays : [1],
    monthDay: cadence.kind === 'monthly' ? String(cadence.day) : '1',
    intervalHours: cadence.kind === 'interval' ? String(cadence.hours) : '6',
    timezone: schedule.timezone,
    model: schedule.options.model ?? '',
    reasoning: schedule.options.reasoning,
    reasoningEffort: schedule.options.reasoningEffort,
    webEnabled: schedule.options.webEnabled,
    baziChartId: schedule.options.baziChartId ?? '',
    notify: schedule.options.notify,
    knowledgeBaseIds: schedule.options.knowledgeBaseIds,
    collaborators: schedule.options.collaborators,
  };
}

function draftFromTemplate(template: AgentScheduleTemplate, defaultChartId: string | null): Draft {
  if (template === BRIEFING) {
    return {
      name: '每日早报', template: BRIEFING, prompt: dailyBriefingPrompt(defaultChartId),
      kind: 'daily', time: '08:00', weekdays: [1], monthDay: '1', intervalHours: '6',
      timezone: browserTimeZone(), model: '', reasoning: false, reasoningEffort: null, webEnabled: false,
      baziChartId: defaultChartId ?? '', notify: true, knowledgeBaseIds: [], collaborators: [],
    };
  }
  return {
    name: '', template: CUSTOM, prompt: '', kind: 'daily', time: '08:00', weekdays: [1],
    monthDay: '1', intervalHours: '6', timezone: browserTimeZone(), model: '', reasoning: false,
    reasoningEffort: null, webEnabled: true, baziChartId: defaultChartId ?? '', notify: true,
    knowledgeBaseIds: [], collaborators: [],
  };
}

function cadenceOf(draft: Draft): AgentScheduleCadence {
  if (draft.kind === 'weekly') return { kind: 'weekly', weekdays: [...draft.weekdays].sort((a, b) => a - b), time: draft.time };
  if (draft.kind === 'monthly') return { kind: 'monthly', day: Number(draft.monthDay), time: draft.time };
  if (draft.kind === 'interval') return { kind: 'interval', hours: Number(draft.intervalHours), time: draft.time };
  return { kind: 'daily', time: draft.time };
}

export function ScheduleEditor({
  open, userId, schedule, template, onClose, onSaved,
}: {
  open: boolean;
  userId: string;
  schedule?: AgentScheduleView | null;
  template?: AgentScheduleTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const headingId = useId();
  const { showToast } = useToast();
  const client = useMemo(() => agentScheduleClient(userId), [userId]);
  const chartsQuery = useUserCharts(userId);
  const modelsQuery = useAvailableModels(userId);
  const charts = useMemo(() => listSavedBaziCharts(chartsQuery.data), [chartsQuery.data]);
  const defaultChartId = chartsQuery.data?.defaultChartIds?.bazi ?? null;
  const [draft, setDraft] = useState<Draft>(() => schedule ? draftFromSchedule(schedule) : draftFromTemplate(template ?? CUSTOM, defaultChartId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const editing = Boolean(schedule);
  const models = (modelsQuery.data ?? []).filter(model => model.allowed !== false);
  const patch = (value: Partial<Draft>) => setDraft(current => ({ ...current, ...value }));

  const chooseTemplate = (next: AgentScheduleTemplate) => {
    if (editing) return;
    if (next === BRIEFING) {
      patch({ template: next, name: '每日早报', prompt: dailyBriefingPrompt(draft.baziChartId || null), kind: 'daily', webEnabled: false });
    } else {
      patch({ template: next });
    }
  };

  const save = async () => {
    setError('');
    let input;
    try {
      const options: AgentScheduleOptions = {
        ...defaultAgentScheduleOptions(),
        model: draft.model || null,
        reasoning: draft.reasoning,
        reasoningEffort: draft.reasoningEffort,
        webEnabled: draft.webEnabled,
        baziChartId: draft.baziChartId || null,
        notify: draft.notify,
        knowledgeBaseIds: draft.knowledgeBaseIds,
        collaborators: draft.collaborators,
      };
      input = parseAgentScheduleInput({
        name: draft.name, template: draft.template, prompt: draft.prompt,
        cadence: cadenceOf(draft), timezone: draft.timezone, options,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '填写有误');
      return;
    }
    setSaving(true);
    try {
      if (schedule) await client.update(schedule.id, input);
      else await client.create(input);
      showToast('success', schedule ? '定时任务已保存' : '定时任务已创建');
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy={headingId} busy={saving} className="max-w-2xl">
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <h2 id={headingId} className="font-display text-xl text-foreground">{editing ? '编辑定时任务' : '新建定时任务'}</h2>
        <div className="mt-4 flex flex-col gap-4">
          {!editing ? (
            <div role="group" aria-label="任务模板" className="flex gap-2">
              <button type="button" className="settings-chip" aria-pressed={draft.template === CUSTOM} disabled={saving} onClick={() => chooseTemplate(CUSTOM)}>自定义</button>
              <button type="button" className="settings-chip" aria-pressed={draft.template === BRIEFING} disabled={saving} onClick={() => chooseTemplate(BRIEFING)}>每日早报</button>
            </div>
          ) : null}
          <label className="settings-field">任务名称
            <input className="settings-input" aria-label="任务名称" value={draft.name} maxLength={AGENT_SCHEDULE_NAME_MAX} disabled={saving}
              onChange={event => patch({ name: event.target.value })} />
          </label>
          <label className="settings-field">执行内容
            <textarea className="settings-input min-h-[9rem]" aria-label="执行内容" value={draft.prompt} maxLength={AGENT_SCHEDULE_PROMPT_MAX} disabled={saving}
              onChange={event => patch({ prompt: event.target.value })} />
          </label>
          <p className="text-xs text-foreground-tertiary">可用变量：{'{{date}} 日期、{{time}} 时间、{{weekday}} 星期、{{timezone}} 时区、{{name}} 任务名称'}。每次运行会把这一轮追加到绑定的对话。</p>
          <div className="flex flex-wrap gap-3">
            <label className="settings-field">执行频率
              <select className="settings-select" aria-label="执行频率" value={draft.kind} disabled={saving}
                onChange={event => patch({ kind: event.target.value as AgentScheduleKind })}>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="interval">固定间隔</option>
              </select>
            </label>
            {draft.kind === 'monthly' ? (
              <label className="settings-field">每月日期
                <input className="settings-input w-20" aria-label="每月日期" inputMode="numeric" value={draft.monthDay} disabled={saving}
                  onChange={event => patch({ monthDay: event.target.value })} />
              </label>
            ) : null}
            {draft.kind === 'interval' ? (
              <label className="settings-field">间隔小时
                <input className="settings-input w-20" aria-label="间隔小时" inputMode="numeric" value={draft.intervalHours} disabled={saving}
                  onChange={event => patch({ intervalHours: event.target.value })} />
              </label>
            ) : null}
            <label className="settings-field">执行时间
              <input className="settings-input w-28" aria-label="执行时间" type="time" value={draft.time} disabled={saving}
                onChange={event => patch({ time: event.target.value })} />
            </label>
            <label className="settings-field min-w-[12rem] flex-1">时区
              <select className="settings-select w-full" aria-label="时区" value={draft.timezone} disabled={saving}
                onChange={event => patch({ timezone: event.target.value })}>
                {timeZones(draft.timezone).map(zone => <option key={zone}>{zone}</option>)}
              </select>
            </label>
          </div>
          {draft.kind === 'weekly' ? (
            <div role="group" aria-label="每周运行日" className="flex flex-wrap gap-2">
              {AGENT_SCHEDULE_WEEKDAY_LABELS.map((label, index) => {
                const day = index + 1;
                const on = draft.weekdays.includes(day);
                return <button key={day} type="button" className="settings-chip" aria-pressed={on} disabled={saving}
                  onClick={() => patch({ weekdays: on ? draft.weekdays.filter(item => item !== day) : [...draft.weekdays, day] })}>{label}</button>;
              })}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <label className="settings-field min-w-[11rem] flex-1">模型
              <select className="settings-select w-full" aria-label="模型" value={draft.model} disabled={saving}
                onChange={event => patch({ model: event.target.value })}>
                <option value="">跟随默认模型</option>
                {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            </label>
            <label className="settings-field min-w-[11rem] flex-1">绑定命盘
              <select className="settings-select w-full" aria-label="绑定命盘" value={draft.baziChartId} disabled={saving}
                onChange={event => patch(draft.template === BRIEFING
                  ? { baziChartId: event.target.value, prompt: dailyBriefingPrompt(event.target.value || null) }
                  : { baziChartId: event.target.value })}>
                <option value="">默认命盘</option>
                {charts.map(chart => <option key={chart.id} value={chart.id}>{chart.name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-foreground-secondary">
            <label className="flex items-center gap-2"><input type="checkbox" aria-label="推理" checked={draft.reasoning} disabled={saving} onChange={event => patch({ reasoning: event.target.checked })} />推理</label>
            <label className="flex items-center gap-2"><input type="checkbox" aria-label="联网" checked={draft.webEnabled} disabled={saving} onChange={event => patch({ webEnabled: event.target.checked })} />联网</label>
            <label className="flex items-center gap-2"><input type="checkbox" aria-label="完成后通知" checked={draft.notify} disabled={saving} onChange={event => patch({ notify: event.target.checked })} />完成后通知</label>
          </div>
          {draft.kind === 'interval' ? <p className="text-xs text-foreground-tertiary">间隔为 1–{AGENT_SCHEDULE_INTERVAL_HOURS_MAX} 小时，按本地时间的执行时刻循环。</p> : null}
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
        <div className="mt-6 flex justify-end gap-2.5">
          <button type="button" className="settings-button settings-button-ghost" disabled={saving} onClick={onClose}>取消</button>
          <button type="button" className="settings-button settings-button-primary" disabled={saving} onClick={() => { void save(); }}>
            {saving ? <SoundWaveLoader variant="inline" /> : null}保存
          </button>
        </div>
      </div>
    </Modal>
  );
}
