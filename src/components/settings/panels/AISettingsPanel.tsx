/**
 * AI 个性化设置内容
 *
 * 'use client' 标记说明：
 * - 使用 hooks 管理用户偏好表单和保存状态
 * - 该模块供统一设置中心复用
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { AgentPreferencesPanel } from './AgentPreferencesPanel';

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

// 预览色只示意三种风格的观感，实际图表由 AI 按风格描述生成。
const CHART_STYLE_OPTIONS: Array<{ value: VisualizationChartStyle; label: string; previewClass: string }> = [
  { value: 'modern', label: '简约现代', previewClass: 'is-modern' },
  { value: 'classic-chinese', label: '经典中式', previewClass: 'is-classic' },
  { value: 'dark', label: '暗色高对比', previewClass: 'is-dark' },
];
const CHART_PREVIEW_BARS = ['40%', '75%', '55%', '90%'];
const DAYUN_PERIOD_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10];
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
const MIN_DIMENSIONS = 3;
const MAX_DIMENSIONS = 12;
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

export default function AISettingsPanel() {
  const { user } = useSessionSafe();
  return <><AccountAISettingsPanel key={user?.id ?? 'visitor'} />{user && <AgentPreferencesPanel key={`agent:${user.id}`} userId={user.id} />}</>;
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
  useUnsavedSettingsGuard(isDirty);

  const handleToggleDimension = (key: FortuneDimensionKey) => {
    const alreadySelected = selectedDimensions.includes(key);
    if (alreadySelected) {
      if (selectedDimensions.length <= MIN_DIMENSIONS) {
        showToast('info', `至少保留 ${MIN_DIMENSIONS} 个维度`);
        return;
      }
      setSelectedDimensions(selectedDimensions.filter((item) => item !== key));
      return;
    }

    if (selectedDimensions.length >= MAX_DIMENSIONS) {
      showToast('info', `最多选择 ${MAX_DIMENSIONS} 个维度`);
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
      <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-border bg-surface">
        <SoundWaveLoader variant="inline" />
      </div>
    );
  }

  if (!user) {
    return <SettingsLoginRequired title="请先登录后配置 AI 个性化" />;
  }

  const identityDraft = userProfile?.identity ?? '';

  return (
    <div>
      {error ? <div role="alert" className="settings-alert">{error}</div> : null}

      <section className="settings-form-section" aria-labelledby="ai-style-heading">
        <div className="settings-form-heading">
          <h3 id="ai-style-heading">解读风格</h3>
        </div>

        <div className="settings-field-block">
          <div className="settings-label-row">
            <label htmlFor="ai-identity">身份</label>
            <span className="settings-counter">{identityDraft.length} / {USER_PROFILE_LIMIT}</span>
          </div>
          <input
            id="ai-identity"
            value={identityDraft}
            maxLength={USER_PROFILE_LIMIT}
            onChange={(event) => {
              // 输入过程中保留空格，保存快照时再统一去除首尾空白。
              const identity = event.target.value.slice(0, USER_PROFILE_LIMIT);
              setUserProfile(identity ? { identity } : null);
            }}
            className="settings-input settings-input-lg"
            placeholder="例如：创业者"
          />
        </div>

        <div className="settings-inline-row">
          <span>表达风格</span>
          <SegmentedChoice
            ariaLabel="表达风格"
            value={expressionStyle}
            onChange={setExpressionStyle}
            options={EXPRESSION_STYLE_OPTIONS}
            maxWidth={200}
          />
        </div>

        <div className="settings-field-block">
          <div className="settings-inline-row">
            <span>命盘注入详细级别</span>
            <SegmentedChoice
              ariaLabel="命盘注入详细级别"
              value={chartPromptDetailLevel}
              onChange={handleChartPromptDetailLevelChange}
              options={CHART_PROMPT_DETAIL_OPTIONS_UI}
              maxWidth={216}
            />
          </div>
          <p className="settings-help">
            用于对话中的命盘注入与结果页解读。默认档噪音更少；完整档附带神煞、纳音、格局等字段。扩展档目前只对六爻单独生效，其余占术按完整档处理。
          </p>
        </div>

        <div className="settings-field-block">
          <div className="settings-label-row">
            <label htmlFor="ai-custom-instructions">自定义指令</label>
            <span className="settings-counter">{customInstructions.length} / {CUSTOM_INSTRUCTIONS_LIMIT}</span>
          </div>
          <textarea
            id="ai-custom-instructions"
            rows={3}
            value={customInstructions}
            onChange={(event) => setCustomInstructions(event.target.value.slice(0, CUSTOM_INSTRUCTIONS_LIMIT))}
            className="settings-textarea"
            placeholder="例如：先给结论，再给依据；避免空话和术语堆叠。"
          />
        </div>
      </section>

      <section className="settings-form-section" aria-labelledby="ai-visualization-heading">
        <div className="settings-form-heading">
          <h3 id="ai-visualization-heading">运势可视化</h3>
          <p>AI 输出运势图表时默认关注的维度、图表风格与大运期数。</p>
        </div>

        <div className="settings-field-block">
          <div className="settings-label-row">
            <span id="ai-dimensions-label">维度</span>
            <span className="settings-counter">已选 {selectedDimensions.length} · 至少 {MIN_DIMENSIONS}，最多 {MAX_DIMENSIONS}</span>
          </div>
          <div role="group" aria-labelledby="ai-dimensions-label" className="settings-chips">
            {allDimensions.map((dimension) => (
              <button
                key={dimension.key}
                type="button"
                aria-pressed={selectedDimensions.includes(dimension.key)}
                onClick={() => handleToggleDimension(dimension.key)}
                className="settings-chip"
              >
                {dimension.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-inline-row">
          <label htmlFor="ai-dayun-periods">默认展示大运期数</label>
          <select
            id="ai-dayun-periods"
            value={dayunPeriods}
            onChange={(event) => setDayunPeriods(Number(event.target.value))}
            className="settings-select settings-select-compact"
          >
            {DAYUN_PERIOD_OPTIONS.map((count) => (
              <option key={count} value={count}>{count} 期</option>
            ))}
          </select>
        </div>

        <div className="settings-field-block">
          <span id="ai-chart-style-label" className="settings-label">图表风格</span>
          <div role="radiogroup" aria-labelledby="ai-chart-style-label" className="settings-choice-cards">
            {CHART_STYLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={chartStyle === option.value}
                onClick={() => setChartStyle(option.value)}
                className="settings-choice-card"
              >
                <span aria-hidden="true" className={`settings-chart-preview ${option.previewClass}`}>
                  {CHART_PREVIEW_BARS.map((height, index) => <span key={index} style={{ height }} />)}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {isDirty ? (
        <div className="settings-save-bar">
          <p>个性化设置已修改，保存后生效。</p>
          <button type="button" onClick={handleCancel} disabled={saving} className="settings-button">
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || settingsLoadFailed}
            className="settings-button settings-button-primary"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
