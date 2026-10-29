/**
 * 新建 / 编辑定时任务。模板只决定初始内容：每日早报填入黄历与默认命盘的提示词，
 * 之后时间、时区、执行内容和模型都可以改。
 *
 * 'use client' 标记说明：
 * - 表单草稿、保存状态、模型与命盘选择都在浏览器完成
 */
'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { PenLine, Sunrise, X } from 'lucide-react';
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
import './schedule-editor.css';

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

const TEMPLATES: ReadonlyArray<{ id: AgentScheduleTemplate; title: string; detail: string; icon: typeof PenLine }> = [
  { id: CUSTOM, title: '自定义', detail: '从空白开始写要它做什么', icon: PenLine },
  { id: BRIEFING, title: '每日早报', detail: '填入黄历与默认命盘的晨间简报', icon: Sunrise },
];

const KINDS: ReadonlyArray<{ value: AgentScheduleKind; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'interval', label: '固定间隔' },
];

const PROMPT_VARIABLES = ['{{date}}', '{{time}}', '{{weekday}}', '{{timezone}}', '{{name}}'] as const;

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
  const promptRef = useRef<HTMLTextAreaElement>(null);
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

  const appendVariable = (token: string) => {
    const next = `${draft.prompt}${draft.prompt && !/\s$/u.test(draft.prompt) ? ' ' : ''}${token}`;
    patch({ prompt: next });
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(next.length, next.length);
    });
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

  const sectionHead = (title: string, detail?: string) => (
    <div className="sched-section-head">
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} labelledBy={headingId} busy={saving} className="schedule-editor-dialog">
      <div className="sched-shell">
        <header className="sched-head">
          <div className="sched-head-text">
            <h2 id={headingId}>{editing ? '编辑定时任务' : '新建定时任务'}</h2>
            <p>到点后 Agent 会按下面的内容运行，每一轮都会追加到绑定的对话。</p>
          </div>
          <button type="button" className="sched-close" aria-label="关闭" disabled={saving} onClick={onClose}><X size={16} /></button>
        </header>

        <div className="sched-body">
          {!editing && <section className="sched-section">
            {sectionHead('模板', '只决定初始内容，之后都可以改。')}
            <div className="sched-templates" role="radiogroup" aria-label="任务模板">
              {TEMPLATES.map(({ id, title, detail, icon: Icon }) => (
                <button key={id} type="button" role="radio" aria-checked={draft.template === id} className="sched-template"
                  disabled={saving} onClick={() => chooseTemplate(id)}>
                  <span className="sched-template-icon"><Icon size={16} aria-hidden="true" /></span>
                  <span className="sched-template-text"><strong>{title}</strong><small>{detail}</small></span>
                </button>
              ))}
            </div>
          </section>}

          <section className="sched-section">
            {sectionHead('内容')}
            <label className="sched-field"><span>任务名称</span>
              <input className="sched-input" aria-label="任务名称" value={draft.name} maxLength={AGENT_SCHEDULE_NAME_MAX} disabled={saving}
                placeholder="例如：每日早报" onChange={event => patch({ name: event.target.value })} />
            </label>
            <label className="sched-field"><span>执行内容</span>
              <textarea ref={promptRef} className="sched-textarea" aria-label="执行内容" rows={5} value={draft.prompt} maxLength={AGENT_SCHEDULE_PROMPT_MAX}
                disabled={saving} placeholder="例如：结合今天的干支与我的命盘，写一段 200 字以内的晨间提示。"
                onChange={event => patch({ prompt: event.target.value })} />
            </label>
            <div className="sched-vars">
              <span className="sched-hint">可用变量</span>
              {PROMPT_VARIABLES.map(token => <button key={token} type="button" className="sched-var" disabled={saving}
                onClick={() => appendVariable(token)}>{token}</button>)}
            </div>
          </section>

          <section className="sched-section">
            {sectionHead('时间')}
            <div className="sched-segmented" role="radiogroup" aria-label="执行频率">
              {KINDS.map(kind => <button key={kind.value} type="button" role="radio" aria-checked={draft.kind === kind.value}
                disabled={saving} onClick={() => patch({ kind: kind.value })}>{kind.label}</button>)}
            </div>
            <div className="sched-grid">
              {draft.kind === 'monthly' && <label className="sched-field"><span>每月日期</span>
                <span className="sched-with-unit">
                  <input className="sched-input" aria-label="每月日期" inputMode="numeric" value={draft.monthDay} disabled={saving}
                    onChange={event => patch({ monthDay: event.target.value })} />
                  <span>日</span>
                </span>
              </label>}
              {draft.kind === 'interval' && <label className="sched-field"><span>间隔</span>
                <span className="sched-with-unit">
                  <input className="sched-input" aria-label="间隔小时" inputMode="numeric" value={draft.intervalHours} disabled={saving}
                    onChange={event => patch({ intervalHours: event.target.value })} />
                  <span>小时</span>
                </span>
              </label>}
              <label className="sched-field"><span>执行时间</span>
                <input className="sched-input" aria-label="执行时间" type="time" value={draft.time} disabled={saving}
                  onChange={event => patch({ time: event.target.value })} />
              </label>
              <label className="sched-field"><span>时区</span>
                <select className="sched-select" aria-label="时区" value={draft.timezone} disabled={saving}
                  onChange={event => patch({ timezone: event.target.value })}>
                  {timeZones(draft.timezone).map(zone => <option key={zone}>{zone}</option>)}
                </select>
              </label>
            </div>
            {draft.kind === 'weekly' ? (
              <div className="sched-weekdays" role="group" aria-label="每周运行日">
                {AGENT_SCHEDULE_WEEKDAY_LABELS.map((label, index) => {
                  const day = index + 1;
                  const on = draft.weekdays.includes(day);
                  return <button key={day} type="button" className="sched-day" aria-pressed={on} disabled={saving}
                    onClick={() => patch({ weekdays: on ? draft.weekdays.filter(item => item !== day) : [...draft.weekdays, day] })}>{label}</button>;
                })}
              </div>
            ) : null}
            {draft.kind === 'interval' ? <p className="sched-hint">间隔为 1–{AGENT_SCHEDULE_INTERVAL_HOURS_MAX} 小时，从执行时刻起循环。</p> : null}
            {draft.kind === 'weekly' && draft.weekdays.length === 0 ? <p className="sched-hint" data-tone="warning">至少选择一天。</p> : null}
          </section>

          <section className="sched-section">
            {sectionHead('运行设置')}
            <div className="sched-grid">
              <label className="sched-field"><span>模型</span>
                <select className="sched-select" aria-label="模型" value={draft.model} disabled={saving}
                  onChange={event => patch({ model: event.target.value })}>
                  <option value="">跟随默认模型</option>
                  {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              </label>
              <label className="sched-field"><span>绑定命盘</span>
                <select className="sched-select" aria-label="绑定命盘" value={draft.baziChartId} disabled={saving}
                  onChange={event => patch(draft.template === BRIEFING
                    ? { baziChartId: event.target.value, prompt: dailyBriefingPrompt(event.target.value || null) }
                    : { baziChartId: event.target.value })}>
                  <option value="">默认命盘</option>
                  {charts.map(chart => <option key={chart.id} value={chart.id}>{chart.name}</option>)}
                </select>
              </label>
            </div>
            <div className="sched-toggles">
              <div className="sched-toggle-row">
                <div><span>推理</span><small>先思考再执行，适合需要分析的晨报与复盘</small></div>
                <button type="button" role="switch" aria-checked={draft.reasoning} aria-label="推理" className="sched-switch" disabled={saving}
                  onClick={() => patch({ reasoning: !draft.reasoning })}><span aria-hidden="true" /></button>
              </div>
              <div className="sched-toggle-row">
                <div><span>联网</span><small>允许搜索与调用已接入的连接器</small></div>
                <button type="button" role="switch" aria-checked={draft.webEnabled} aria-label="联网" className="sched-switch" disabled={saving}
                  onClick={() => patch({ webEnabled: !draft.webEnabled })}><span aria-hidden="true" /></button>
              </div>
              <div className="sched-toggle-row">
                <div><span>完成后通知</span><small>任务结束或失败时推送一条通知</small></div>
                <button type="button" role="switch" aria-checked={draft.notify} aria-label="完成后通知" className="sched-switch" disabled={saving}
                  onClick={() => patch({ notify: !draft.notify })}><span aria-hidden="true" /></button>
              </div>
            </div>
          </section>

          {error ? <p role="alert" className="sched-error">{error}</p> : null}
        </div>

        <footer className="sched-foot">
          <span className="sched-hint">保存后按设定时间运行</span>
          <div className="sched-actions">
            <button type="button" className="sched-button" disabled={saving} onClick={onClose}>取消</button>
            <button type="button" className="sched-button is-primary" disabled={saving} onClick={() => { void save(); }}>
              {saving ? <SoundWaveLoader variant="inline" /> : null}{editing ? '保存' : '创建任务'}
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
