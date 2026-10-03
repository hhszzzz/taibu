/**
 * AI 个性化设置内容
 *
 * 'use client' 标记说明：
 * - 使用 hooks 管理用户偏好表单和保存状态
 * - 该模块供统一设置中心复用
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Save, X } from 'lucide-react';
import {
  ADVANCED_DIMENSIONS,
  CORE_DIMENSIONS,
  type FortuneDimensionKey,
} from '@/lib/visualization/dimensions';
import { readLocalVisualizationSettings, type VisualizationChartStyle } from '@/lib/visualization/settings';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useToast } from '@/components/ui/Toast';
import { SegmentedChoice } from '@/components/settings/SegmentedChoice';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { getCurrentUserSettings, type UserIdentityProfile, updateCurrentUserSettings } from '@/lib/user/settings';
import { syncVisualizationPreferencesAfterSave } from '@/lib/user/ai-settings-local-sync';
import { CHART_TEXT_DETAIL_OPTIONS, type ChartTextDetailLevel } from '@/lib/divination/detail-level';

type ExpressionStyle = 'direct' | 'gentle';
type UserProfileDraft = UserIdentityProfile | null;

type AISettingsDraftSnapshot = {
  expressionStyle: ExpressionStyle;
  chartPromptDetailLevel: ChartTextDetailLevel;
  customInstructions: string;
  selectedDimensions: FortuneDimensionKey[];
  dayunPeriods: number;
  chartStyle: VisualizationChartStyle;
  userProfile: UserProfileDraft;
};

const CHART_STYLE_OPTIONS: Array<{ value: VisualizationChartStyle; label: string }> = [
  { value: 'modern', label: '简约现代' },
  { value: 'classic-chinese', label: '经典中式' },
  { value: 'dark', label: '暗色高对比' },
];
const EXPRESSION_STYLE_OPTIONS: Array<{ value: ExpressionStyle; label: string }> = [
  { value: 'direct', label: '直接干练' },
  { value: 'gentle', label: '温和委婉' },
];
const CHART_PROMPT_DETAIL_OPTIONS_UI = CHART_TEXT_DETAIL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const USER_PROFILE_LIMIT = 120;
const CUSTOM_INSTRUCTIONS_LIMIT = 4000;
const EMPTY_USER_PROFILE: UserProfileDraft = null;

function normalizeUserProfileDraft(userProfile: UserProfileDraft): UserProfileDraft {
  const identity = userProfile?.identity?.trim() ?? '';
  return identity ? { identity } : null;
}

function buildDraftSnapshot(input: {
  expressionStyle: ExpressionStyle;
  chartPromptDetailLevel: ChartTextDetailLevel;
  customInstructions: string;
  selectedDimensions: FortuneDimensionKey[];
  dayunPeriods: number;
  chartStyle: VisualizationChartStyle;
  userProfile: UserProfileDraft;
}): AISettingsDraftSnapshot {
  return {
    expressionStyle: input.expressionStyle,
    chartPromptDetailLevel: input.chartPromptDetailLevel,
    customInstructions: input.customInstructions,
    selectedDimensions: [...input.selectedDimensions],
    dayunPeriods: input.dayunPeriods,
    chartStyle: input.chartStyle,
    userProfile: normalizeUserProfileDraft(input.userProfile),
  };
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
  );
}

function SectionDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm text-foreground-secondary">{children}</p>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-xs font-medium text-foreground/60">{children}</label>;
}

export default function AISettingsPanel() {
  const { user } = useSessionSafe();
  return <AccountAISettingsPanel key={user?.id ?? 'visitor'} />;
}

function AccountAISettingsPanel() {
  const { user, loading: sessionLoading } = useSessionSafe();
  const userId = user?.id;
  const lifecycle = useRef<AbortController | null>(null);
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);

  const [expressionStyle, setExpressionStyle] = useState<ExpressionStyle>('direct');
  const [chartPromptDetailLevel, setChartPromptDetailLevel] = useState<ChartTextDetailLevel>('default');
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedDimensions, setSelectedDimensions] = useState<FortuneDimensionKey[]>(
    () => CORE_DIMENSIONS.slice(0, 6).map((dimension) => dimension.key),
  );
  const [dayunPeriods, setDayunPeriods] = useState(5);
  const [chartStyle, setChartStyle] = useState<VisualizationChartStyle>('modern');
  const [userProfile, setUserProfile] = useState<UserProfileDraft>(EMPTY_USER_PROFILE);
  const [savedSnapshot, setSavedSnapshot] = useState<AISettingsDraftSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyDraftSnapshot = (snapshot: AISettingsDraftSnapshot) => {
    setExpressionStyle(snapshot.expressionStyle);
    setChartPromptDetailLevel(snapshot.chartPromptDetailLevel);
    setCustomInstructions(snapshot.customInstructions);
    setSelectedDimensions(snapshot.selectedDimensions);
    setDayunPeriods(snapshot.dayunPeriods);
    setChartStyle(snapshot.chartStyle);
    setUserProfile(snapshot.userProfile);
  };

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    const init = async () => {
      if (sessionLoading) return;
      if (!userId) {
        setSavedSnapshot(null);
        setLoading(false);
        return;
      }

      const { settings, error: loadError } = await getCurrentUserSettings({ expectedUserId: userId, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (loadError) {
        setSavedSnapshot(null);
        setError(loadError.message || '加载个性化设置失败');
        setSettingsLoadFailed(true);
        setLoading(false);
        return;
      }

      setSettingsLoadFailed(false);
      const nextExpressionStyle = (settings?.expressionStyle || 'direct') as ExpressionStyle;
      const nextChartPromptDetailLevel = settings?.chartPromptDetailLevel || 'default';
      const nextCustomInstructions = (settings?.customInstructions || '').slice(0, CUSTOM_INSTRUCTIONS_LIMIT);

      const visualizationSettings = settings?.visualizationSettings || readLocalVisualizationSettings(localStorage);
      let nextSelectedDimensions = CORE_DIMENSIONS.slice(0, 6).map((dimension) => dimension.key);
      if (visualizationSettings?.selectedDimensions?.length) {
        nextSelectedDimensions = visualizationSettings.selectedDimensions;
      }
      let nextDayunPeriods = 5;
      if (typeof visualizationSettings?.dayunDisplayCount === 'number') {
        nextDayunPeriods = visualizationSettings.dayunDisplayCount;
      }
      let nextChartStyle: VisualizationChartStyle = 'modern';
      if (visualizationSettings?.chartStyle) {
        nextChartStyle = visualizationSettings.chartStyle;
      }

      const nextUserProfile = settings?.userProfile?.identity
        ? { identity: settings.userProfile.identity.slice(0, USER_PROFILE_LIMIT) }
        : EMPTY_USER_PROFILE;

      const snapshot = buildDraftSnapshot({
        expressionStyle: nextExpressionStyle,
        chartPromptDetailLevel: nextChartPromptDetailLevel,
        customInstructions: nextCustomInstructions,
        selectedDimensions: nextSelectedDimensions,
        dayunPeriods: nextDayunPeriods,
        chartStyle: nextChartStyle,
        userProfile: nextUserProfile,
      });

      applyDraftSnapshot(snapshot);
      setSavedSnapshot(snapshot);

      setLoading(false);
    };

    void init().catch(() => {
      if (controller.signal.aborted) return;
      setError('加载个性化设置失败');
      setSettingsLoadFailed(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [sessionLoading, userId]);

  const allDimensions = useMemo(
    () => [...CORE_DIMENSIONS, ...ADVANCED_DIMENSIONS],
    [],
  );
  const draftSnapshot = useMemo(() => buildDraftSnapshot({
    expressionStyle,
    chartPromptDetailLevel,
    customInstructions,
    selectedDimensions,
    dayunPeriods,
    chartStyle,
    userProfile,
  }), [chartPromptDetailLevel, chartStyle, customInstructions, dayunPeriods, expressionStyle, selectedDimensions, userProfile]);
  const isDirty = useMemo(() => (
    savedSnapshot ? JSON.stringify(draftSnapshot) !== JSON.stringify(savedSnapshot) : false
  ), [draftSnapshot, savedSnapshot]);

  const handleToggleDimension = (key: FortuneDimensionKey) => {
    const alreadySelected = selectedDimensions.includes(key);
    if (alreadySelected) {
      if (selectedDimensions.length <= 3) {
        return;
      }
      setSelectedDimensions(selectedDimensions.filter((item) => item !== key));
      return;
    }

    if (selectedDimensions.length >= 12) {
      return;
    }
    setSelectedDimensions([...selectedDimensions, key]);
  };

  const handleChartPromptDetailLevelChange = (nextLevel: ChartTextDetailLevel) => {
    setChartPromptDetailLevel(nextLevel);
  };

  const handleSave = async () => {
    const controller = lifecycle.current;
    if (!userId || settingsLoadFailed || saving || loading || !controller || controller.signal.aborted) return;

    setError(null);
    setSaving(true);

    const nextSavedSnapshot = draftSnapshot;
    const profilePayload = nextSavedSnapshot.userProfile?.identity ? nextSavedSnapshot.userProfile : null;

    const saved = await updateCurrentUserSettings({
      expressionStyle: nextSavedSnapshot.expressionStyle,
      chartPromptDetailLevel: nextSavedSnapshot.chartPromptDetailLevel,
      customInstructions: nextSavedSnapshot.customInstructions || null,
      userProfile: profilePayload,
      visualizationSettings: {
        selectedDimensions: nextSavedSnapshot.selectedDimensions,
        dayunDisplayCount: nextSavedSnapshot.dayunPeriods,
        chartStyle: nextSavedSnapshot.chartStyle,
      },
    }, undefined, { expectedUserId: userId, signal: controller.signal }).catch(() => null);
    if (controller.signal.aborted) return;

    setSaving(false);

    const synced = syncVisualizationPreferencesAfterSave(
      localStorage,
      {
        selectedDimensions: nextSavedSnapshot.selectedDimensions,
        dayunDisplayCount: nextSavedSnapshot.dayunPeriods,
        chartStyle: nextSavedSnapshot.chartStyle,
      },
      saved,
    );

    if (!synced || !saved) {
      setError('保存失败');
      showToast('error', '保存失败');
      return;
    }

    // Advance the saved baseline only; edits made during the request remain dirty.
    setSavedSnapshot(nextSavedSnapshot);
    showToast('success', '个性化设置已保存');
  };

  const handleCancel = () => {
    if (!savedSnapshot || saving) return;
    setError(null);
    applyDraftSnapshot(savedSnapshot);
  };

  if (loading || sessionLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-border bg-background">
        <SoundWaveLoader variant="inline" />
      </div>
    );
  }

  if (!user) {
    return <SettingsLoginRequired title="请先登录后配置 AI 个性化" />;
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <FieldLabel>身份</FieldLabel>
            <input
              value={userProfile?.identity ?? ''}
              onChange={(event) => {
                const identity = event.target.value.slice(0, USER_PROFILE_LIMIT).trim();
                setUserProfile(identity ? { identity } : null);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors duration-150 focus:ring-2 focus:ring-blue-500/30"
              placeholder="例如：创业者"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel>表达风格</FieldLabel>
            <select
              value={expressionStyle}
              onChange={(event) => setExpressionStyle(event.target.value as ExpressionStyle)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors duration-150 focus:ring-2 focus:ring-blue-500/30"
            >
              {EXPRESSION_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <FieldLabel>命盘注入详细级别</FieldLabel>
            <SegmentedChoice
              ariaLabel="命盘注入详细级别"
              value={chartPromptDetailLevel}
              onChange={handleChartPromptDetailLevelChange}
              options={CHART_PROMPT_DETAIL_OPTIONS_UI}
              maxWidth={320}
            />
            <p className="text-xs text-foreground-secondary">
              用于聊天命盘注入与结果页 AI 解读 prompt。建议保留默认，默认经过微调能降低噪音。
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>自定义指令</FieldLabel>
              <span className="text-xs text-foreground/50">
                {customInstructions.length}/{CUSTOM_INSTRUCTIONS_LIMIT}
              </span>
            </div>
            <textarea
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value.slice(0, CUSTOM_INSTRUCTIONS_LIMIT))}
              className="min-h-[100px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors duration-150 focus:ring-2 focus:ring-blue-500/30"
              placeholder="例如：先给结论，再给依据；避免空话和术语堆叠。"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle title="运势可视化偏好" />
        <SectionDescription>控制 AI 输出时默认关注的维度、图表风格和大运展示数量。</SectionDescription>

        <div className="space-y-4">
          <div className="space-y-2">
            <FieldLabel>维度选择（至少 3 个，最多 12 个）</FieldLabel>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {allDimensions.map((dimension) => {
                const active = selectedDimensions.includes(dimension.key);
                return (
                  <button
                    key={dimension.key}
                    type="button"
                    onClick={() => handleToggleDimension(dimension.key)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors duration-150 ${
                      active
                        ? 'border-[#cfe3f7] bg-blue-50 text-[#2383e2]'
                        : 'border-border bg-background text-foreground-secondary hover:bg-[#efedea] dark:hover:bg-background-secondary'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{dimension.icon}</span>
                      <span>{dimension.label}</span>
                    </span>
                    {/* <span className="text-xs text-foreground/40">{active ? '已选' : '未选'}</span> */}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel>默认展示大运期数</FieldLabel>
              <select
                value={dayunPeriods}
                onChange={(event) => setDayunPeriods(Number(event.target.value))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors duration-150 focus:ring-2 focus:ring-blue-500/30"
              >
                {[3, 4, 5, 6, 7, 8, 9, 10].map((count) => (
                  <option key={count} value={count}>{count} 期</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <FieldLabel>图表风格</FieldLabel>
              <select
                value={chartStyle}
                onChange={(event) => setChartStyle(event.target.value as VisualizationChartStyle)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors duration-150 focus:ring-2 focus:ring-blue-500/30"
              >
                {CHART_STYLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {isDirty ? (
        <div className="sticky bottom-0 z-20 pb-2">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
            <p className="text-sm font-medium text-foreground">个性化设置已修改，保存后生效。</p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium text-foreground-secondary transition-colors duration-150 hover:bg-[#efedea] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-background-secondary"
              >
                <X className="h-4 w-4" />
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || settingsLoadFailed}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-[#2383e2] bg-[#2383e2] px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#1d74c9] hover:border-[#1d74c9] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <SoundWaveLoader variant="inline" /> : <Save className="h-4 w-4" />}
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
