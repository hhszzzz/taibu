/**
 * 新建 / 编辑定时任务。模板只决定初始需求描述，之后时间、时区、内容和模型都可以改。
 *
 * 'use client' 标记说明：
 * - 表单草稿、保存状态、模型与命盘选择都在浏览器完成
 */
'use client';

import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Switch } from '@/components/ui/Switch';
import { useId, useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import type { AgentCollaborator } from '@/lib/chat/model-settings';
import { useAvailableModels } from '@/lib/hooks/useAvailableModels';
import { REASONING_EFFORT_LABELS } from '@/lib/chat/model-settings';
import { useOwnModels } from '@/lib/byok/client';
import { useUserCharts } from '@/lib/hooks/useUserCharts';
import { listSavedBaziCharts } from '@/lib/user/charts-client';
import { agentScheduleClient } from '@/lib/agent/schedules/client';
import { browserTimeZone } from '@/lib/timezones';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import {
  AGENT_SCHEDULE_INTERVAL_HOURS_MAX, AGENT_SCHEDULE_NAME_MAX, AGENT_SCHEDULE_PROMPT_MAX,
  AGENT_SCHEDULE_WEEKDAY_LABELS, DAILY_BRIEFING_PROMPT, defaultAgentScheduleOptions,
  parseAgentScheduleInput,
  type AgentScheduleCadence, type AgentScheduleKind, type AgentScheduleOptions, type AgentScheduleTemplate,
  type AgentScheduleView,
} from '@/lib/agent/schedules/config';
import './schedule-editor.css';

type Draft = {
  name: string;
  template: AgentScheduleTemplate;
  prompt: string;
  kind: AgentScheduleKind | 'workdays';
  time: string;
  weekdays: number[];
  monthDay: string;
  intervalHours: string;
  timezone: string;
  model: string;
  reasoning: boolean;
  reasoningEffort: AIReasoningEffort | null;
  baziChartId: string;
  notify: boolean;
  knowledgeBaseIds: string[];
  collaborators: AgentCollaborator[];
};

const CUSTOM: AgentScheduleTemplate = 'custom';
const BRIEFING: AgentScheduleTemplate = 'daily_briefing';

const TEMPLATES: ReadonlyArray<{ id: AgentScheduleTemplate; title: string }> = [
  { id: CUSTOM, title: '自定义' },
  { id: BRIEFING, title: '每日早报' },
];

/** 时间下拉：每 15 分钟一档；已有任务的非整档时间原样保留为一项。 */
function timeOfDayOptions(current: string): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    options.push({ value, label: value });
  }
  if (/^\d{2}:\d{2}$/u.test(current) && !options.some(option => option.value === current)) options.push({ value: current, label: current });
  return options;
}

const WORKDAYS = [1, 2, 3, 4, 5];

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 日` }));

const INTERVAL_HOURS = Array.from({ length: AGENT_SCHEDULE_INTERVAL_HOURS_MAX }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 小时` }));

const KINDS: ReadonlyArray<{ value: AgentScheduleKind | 'workdays'; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'workdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'interval', label: '固定间隔' },
];

/** 旧模板末尾那句“附了命盘…不猜测”不再随早报发送，编辑时一并去掉。 */
function trimBriefingPrompt(prompt: string): string {
  return prompt.replace(/附了命盘就结合命盘，没有就给一般建议并说明；没有可用数据时如实说明，不猜测。/u, '').trim();
}

function draftFromSchedule(schedule: AgentScheduleView): Draft {
  const cadence = schedule.cadence;
  return {
    name: schedule.name,
    template: schedule.template,
    prompt: schedule.template === BRIEFING ? trimBriefingPrompt(schedule.prompt) : schedule.prompt,
    kind: cadence.kind === 'weekly' && WORKDAYS.length === cadence.weekdays.length && WORKDAYS.every(day => cadence.weekdays.includes(day)) ? 'workdays' : cadence.kind,
    time: cadence.time,
    weekdays: cadence.kind === 'weekly' ? cadence.weekdays : [1],
    monthDay: cadence.kind === 'monthly' ? String(cadence.day) : '1',
    intervalHours: cadence.kind === 'interval' ? String(cadence.hours) : '6',
    timezone: schedule.timezone,
    model: schedule.options.model ?? '',
    reasoning: schedule.options.reasoning,
    reasoningEffort: schedule.options.reasoningEffort,
    baziChartId: schedule.options.baziChartId ?? '',
    notify: schedule.options.notify,
    knowledgeBaseIds: schedule.options.knowledgeBaseIds,
    collaborators: schedule.options.collaborators,
  };
}

/** 不选命盘时：早报每次运行取设置里当时的默认命盘，自定义任务不带命盘。 */
function draftFromTemplate(template: AgentScheduleTemplate): Draft {
  if (template === BRIEFING) {
    return {
      name: '每日早报', template: BRIEFING, prompt: DAILY_BRIEFING_PROMPT,
      kind: 'daily', time: '08:00', weekdays: [1], monthDay: '1', intervalHours: '6',
      timezone: browserTimeZone(), model: '', reasoning: false, reasoningEffort: null,
      baziChartId: '', notify: true, knowledgeBaseIds: [], collaborators: [],
    };
  }
  return {
    name: '', template: CUSTOM, prompt: '', kind: 'daily', time: '08:00', weekdays: [1],
    monthDay: '1', intervalHours: '6', timezone: browserTimeZone(), model: '', reasoning: false,
    reasoningEffort: null, baziChartId: '', notify: true,
    knowledgeBaseIds: [], collaborators: [],
  };
}

/** 固定间隔以当前时刻为锚，不让用户再选时间。 */
function nowClock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function cadenceOf(draft: Draft): AgentScheduleCadence {
  if (draft.kind === 'workdays') return { kind: 'weekly', weekdays: [...WORKDAYS], time: draft.time };
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
  const own = useOwnModels(userId);
  const charts = useMemo(() => listSavedBaziCharts(chartsQuery.data), [chartsQuery.data]);
  const [draft, setDraft] = useState<Draft>(() => schedule ? draftFromSchedule(schedule) : draftFromTemplate(template ?? CUSTOM));
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState('');
  const editing = Boolean(schedule);
  // 无人值守：自己的模型只列 Key 保存在本站的（由本站代为请求）。
  const models = [
    ...(modelsQuery.data ?? []).map(model => ({ value: model.id, label: model.name })),
    ...own.models.filter(model => model.usage === 'chat' && model.serverKey).map(model => ({ value: model.ref, label: `${model.displayName}（自定义）` })),
  ];
  const patch = (value: Partial<Draft>) => setDraft(current => ({ ...current, ...value }));
  const noChart = draft.template === BRIEFING ? '默认命盘' : '不绑定';
  // 没选模型时用上次在聊天里用过的模型（账户级缓存保存在本机）；缓存不可用时按平台默认。
  const lastUsedModel = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      const raw = JSON.parse(localStorage.getItem(`taibu.next-task:${userId}`) ?? 'null') as { model?: unknown } | null;
      return typeof raw?.model === 'string' ? raw.model : '';
    } catch { return ''; }
  }, [userId]);
  const preferredModel = models.some(item => item.value === lastUsedModel) ? lastUsedModel
    : models.some(item => item.value === DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : models[0]?.value ?? '';
  const modelValue = draft.model || preferredModel;
  // 思考强度与聊天里的模型菜单一致：已知模型只列它支持的档位，不知道时列出全部。
  const effortLevels = useMemo(() => {
    const model = (modelsQuery.data ?? []).find(item => item.id === modelValue)
      ?? own.models.find(item => item.ref === modelValue);
    return model?.thinkingLevels ?? [];
  }, [modelValue, modelsQuery.data, own.models]);
  const effortOptions = [
    { value: '', label: '模型默认' },
    ...AI_REASONING_EFFORTS.filter(level => !effortLevels.length || effortLevels.includes(level))
      .map(level => ({ value: level as string, label: REASONING_EFFORT_LABELS[level] })),
    { value: 'off', label: '关闭推理' },
  ];
  const effortValue = draft.reasoning ? draft.reasoningEffort ?? '' : 'off';

  const chooseTemplate = (next: AgentScheduleTemplate) => {
    if (editing) return;
    if (next === BRIEFING) {
      patch({ template: next, name: '每日早报', prompt: DAILY_BRIEFING_PROMPT, kind: 'daily' });
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
        model: modelValue || null,
        reasoning: draft.reasoning,
        reasoningEffort: draft.reasoningEffort,
        webEnabled: true,
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
      // 出错的多是需要填写的项：把高级展开，别让它在收起时看不见。
      setAdvancedOpen(true);
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
    <Dialog bare open={open} onClose={onClose} labelledBy={headingId} busy={saving} className="schedule-editor-dialog">
      <div className="sched-shell">
        <header className="sched-head">
          <h2 id={headingId}>{editing ? '编辑定时任务' : '新建定时任务'}</h2>
          <IconButton label="关闭" title="关闭" size="md" expand="none" className="rounded-lg" disabled={saving} onClick={onClose}><X size={16} aria-hidden="true" /></IconButton>
        </header>

        <div className="sched-body">
          <div className="sched-prompt-block">
            <Textarea className="sched-prompt" rows={6} aria-label="要太卜做什么" value={draft.prompt} maxLength={AGENT_SCHEDULE_PROMPT_MAX}
              disabled={saving} placeholder="说明…例如：结合我的命盘，每天早上给我今天的工作与生活提示。"
              onChange={event => patch({ prompt: event.target.value })} />
            <p className="sched-hint">像平时聊天一样写需求即可；绑定命盘会像聊天里的资料引用一起交给太卜。</p>
          </div>

          <div className="sched-group" role="group" aria-label="运行时间">
            <div className="sched-row">
              <span className="sched-row-label">重复</span>
              <Select className="sched-row-select" align="end" ariaLabel="执行频率" value={draft.kind} disabled={saving}
                onChange={kind => patch(kind === 'interval' ? { kind, time: nowClock() } : { kind })}
                options={KINDS.map(kind => ({ value: kind.value, label: kind.label, disabled: saving }))} />
            </div>
            {/* 时区取浏览器所在时区（新建时记下，编辑不改）：这里只选时刻；固定间隔从当前时刻起算，不选。 */}
            {draft.kind !== 'interval' && <div className="sched-row">
              <span className="sched-row-label">时间</span>
              <Select className="sched-row-select" align="end" ariaLabel="执行时间" value={draft.time} disabled={saving}
                onChange={time => patch({ time })} options={timeOfDayOptions(draft.time)} />
            </div>}
            {draft.kind === 'weekly' ? (
              <div className="sched-row sched-row-wrap">
                <span className="sched-row-label">运行日</span>
                <div className="sched-weekdays" role="group" aria-label="每周运行日">
                  {AGENT_SCHEDULE_WEEKDAY_LABELS.map((label, index) => {
                    const day = index + 1;
                    const on = draft.weekdays.includes(day);
                    return <Button unstyled key={day} type="button" className="sched-day" aria-pressed={on} disabled={saving}
                      onClick={() => patch({ weekdays: on ? draft.weekdays.filter(item => item !== day) : [...draft.weekdays, day] })}>{label}</Button>;
                  })}
                </div>
              </div>
            ) : null}
            {draft.kind === 'monthly' ? (
              <div className="sched-row">
                <span className="sched-row-label">每月日期</span>
                <Select className="sched-row-select" align="end" ariaLabel="每月日期" value={draft.monthDay} disabled={saving}
                  onChange={monthDay => patch({ monthDay })} options={MONTH_DAYS} />
              </div>
            ) : null}
            {draft.kind === 'interval' ? (
              <div className="sched-row">
                <span className="sched-row-label">间隔</span>
                <Select className="sched-row-select" align="end" ariaLabel="间隔小时" value={draft.intervalHours} disabled={saving}
                  onChange={intervalHours => patch({ intervalHours })} options={INTERVAL_HOURS} />
              </div>
            ) : null}
            {draft.kind === 'weekly' && draft.weekdays.length === 0 ? <p className="sched-row-hint" data-tone="warning">至少选择一天。</p> : null}
          </div>

          <div className="sched-advanced">
            <Button unstyled type="button" className="sched-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(open => !open)}>
              <span>高级</span><ChevronDown size={15} className={advancedOpen ? 'is-open' : undefined} aria-hidden="true" />
            </Button>
            {advancedOpen ? <>
              {!editing ? <div className="sched-group">
                <div className="sched-row">
                  <span className="sched-row-label">模板</span>
                  <Select className="sched-row-select" align="end" ariaLabel="任务模板" value={draft.template} disabled={saving}
                    onChange={chooseTemplate} options={TEMPLATES.map(item => ({ value: item.id, label: item.title }))} />
                </div>
              </div> : null}
              <div className="sched-group">
                <label className="sched-row">
                  <span className="sched-row-label">任务名称</span>
                  <Input className="sched-row-input" aria-label="任务名称" value={draft.name} maxLength={AGENT_SCHEDULE_NAME_MAX} disabled={saving}
                    placeholder="例如：每日早报" onChange={event => patch({ name: event.target.value })} />
                </label>
                <div className="sched-row">
                  <span className="sched-row-label">模型</span>
                  <Select className="sched-row-select" align="end" ariaLabel="模型" placeholder="暂无可用模型"
                    value={modelValue || null} disabled={saving} onChange={model => patch({ model })} options={models} />
                </div>
                <div className="sched-row">
                  <span className="sched-row-label">思考强度</span>
                  <Select className="sched-row-select" align="end" ariaLabel="思考强度" value={effortValue} disabled={saving}
                    onChange={value => patch(value === 'off' ? { reasoning: false, reasoningEffort: null }
                      : { reasoning: true, reasoningEffort: value ? value as AIReasoningEffort : null })}
                    options={effortOptions} />
                </div>
                <div className="sched-row">
                  <span className="sched-row-label">绑定命盘</span>
                  <Select className="sched-row-select" align="end" ariaLabel="绑定命盘" placeholder={noChart}
                    value={draft.baziChartId} disabled={saving}
                    onChange={baziChartId => patch({ baziChartId })}
                    options={[{ value: '', label: noChart }, ...charts.map(chart => ({ value: chart.id, label: chart.name }))]} />
                </div>
              </div>
              <div className="sched-group">
                <div className="sched-toggle-row">
                  <div><span>完成后通知</span><small>任务结束或失败时推送一条通知</small></div>
                  <Switch aria-label="完成后通知" checked={draft.notify} disabled={saving}
                    onCheckedChange={checked => patch({ notify: checked })} />
                </div>
              </div>
            </> : null}
          </div>

          {error ? <p role="alert" className="sched-error">{error}</p> : null}
        </div>

        <footer className="sched-foot">
          <div className="sched-actions">
            <Button variant="secondary" size="md" className="h-9 rounded-lg border-border-hover px-3.5 text-[13px]" disabled={saving} onClick={onClose}>取消</Button>
            <Button size="md" className="h-9 rounded-lg px-3.5 text-[13px]" loading={saving} loadingText={editing ? '保存' : '创建任务'} disabled={saving} onClick={() => { void save(); }}>
              {editing ? '保存' : '创建任务'}
            </Button>
          </div>
        </footer>
      </div>
    </Dialog>
  );

}
