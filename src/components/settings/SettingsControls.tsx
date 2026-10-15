/**
 * 设置中心通用排版：分组、设置行、开关与子页标签。
 *
 * 桌面端设置行以细分隔线排列；手机端同一分组收进白色圆角卡片（见 settings-page.css）。
 */
import type { KeyboardEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {description ? <p className="settings-section-description">{description}</p> : null}
      <div className="settings-group">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  control,
  controlId,
}: {
  label: string;
  description?: ReactNode;
  control: ReactNode;
  /** 控件为原生表单元素时传入其 id，标题会成为可点击的 label。 */
  controlId?: string;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        {controlId
          ? <label htmlFor={controlId} className="settings-row-label">{label}</label>
          : <span className="settings-row-label">{label}</span>}
        {description ? <span className="settings-row-description">{description}</span> : null}
      </div>
      {control}
    </div>
  );
}

export function SettingsSwitch({
  label,
  checked,
  onToggle,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className="settings-switch"
    >
      <span aria-hidden="true" className="settings-switch-thumb" />
    </button>
  );
}

export type SettingsTabOption<T extends string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
};

export function getSettingsTabId(idPrefix: string, id: string) {
  return `${idPrefix}-tab-${id}`;
}

export function getSettingsTabPanelId(idPrefix: string, id: string) {
  return `${idPrefix}-panel-${id}`;
}

/**
 * 分段式子页标签。方向键在标签间移动并直接切换，Home / End 跳到首尾；
 * 面板用 getSettingsTabPanelId 取 id，并以 getSettingsTabId 作 aria-labelledby。
 */
export function SettingsTabs<T extends string>({
  label,
  idPrefix,
  tabs,
  value,
  onChange,
}: {
  label: string;
  idPrefix: string;
  tabs: readonly SettingsTabOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const lastIndex = tabs.length - 1;
    const index = tabs.findIndex((tab) => tab.id === value);
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + lastIndex) % tabs.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? lastIndex
            : -1;
    if (nextIndex < 0 || index < 0) return;
    event.preventDefault();
    const next = tabs[nextIndex].id;
    if (next !== value) onChange(next);
    document.getElementById(getSettingsTabId(idPrefix, next))?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="settings-tabs">
      {tabs.map(({ id, label: tabLabel, icon: Icon }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={getSettingsTabId(idPrefix, id)}
            aria-selected={selected}
            // 未选中的面板可能还没渲染，只让当前标签指向面板，避免引用不存在的 id。
            aria-controls={selected ? getSettingsTabPanelId(idPrefix, id) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => { if (!selected) onChange(id); }}
            onKeyDown={handleKeyDown}
            className="settings-tab"
          >
            {Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}
            {tabLabel}
          </button>
        );
      })}
    </div>
  );
}
