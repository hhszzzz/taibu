/**
 * 设置中心通用排版：分组、设置行、开关与子页标签。
 *
 * 宽屏下组标题与内容分栏；窄屏恢复单栏（见 settings-page.css）。
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { useTabIndicator } from '@/lib/motion/tab-indicator';

export function SettingsSection({
  title,
  description,
  anchor,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** 搜索跳转时定位并高亮的区块名。 */
  anchor?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section" data-settings-highlight={anchor}>
      <div className="settings-section-heading">
        <h3 className="settings-section-title">{title}</h3>
        {description ? <p className="settings-section-description">{description}</p> : null}
      </div>
      <div className="settings-section-body"><div className="settings-group">{children}</div></div>
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
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onToggle}
    />
  );
}

export type SettingsChoiceOption<T extends string> = {
  value: T;
  label: string;
  preview: ReactNode;
};

export function SettingsChoiceCards<T extends string>({
  ariaLabel,
  labelledBy,
  value,
  onChange,
  options,
}: {
  ariaLabel?: string;
  labelledBy?: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly SettingsChoiceOption<T>[];
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const lastIndex = options.length - 1;
    const index = options.findIndex(option => option.value === value);
    const nextIndex = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % options.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + lastIndex) % options.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? lastIndex
            : -1;
    if (nextIndex < 0 || index < 0) return;
    event.preventDefault();
    onChange(options[nextIndex].value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]');
    buttons?.[nextIndex]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-labelledby={labelledBy} className="settings-choice-cards">
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Button unstyled
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown}
            className="settings-choice-card"
          >
            {option.preview}
            <span className="settings-choice-check" aria-hidden="true"><Check size={12} strokeWidth={2.5} /></span>
            <span className="settings-choice-label">{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

export function SettingsSaveBar({
  message,
  saving = false,
  saveDisabled = false,
  saveLabel = '保存更改',
  sticky = true,
  onCancel,
  onSave,
}: {
  message: string;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  /** 同页有两个保存区时，靠后的那个用 false，避免两条浮动保存条叠在一起。 */
  sticky?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className={`settings-save-bar${sticky ? '' : ' is-static'}`}>
      <p role="status"><span className="settings-save-dot" aria-hidden="true" />{message}</p>
      <div className="settings-save-actions">
        <Button variant="ghost" size="lg" onClick={onCancel} disabled={saving}>取消</Button>
        <Button size="lg" onClick={onSave} loading={saving} loadingText="保存中…" disabled={saving || saveDisabled}>{saveLabel}</Button>
      </div>
    </div>
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
  const listRef = useRef<HTMLDivElement>(null);
  useTabIndicator(listRef);
  return (
    <Tabs value={value} onValueChange={(next) => { if (next !== value) onChange(next as T); }}>
      <TabsList ref={listRef} indicator={false} aria-label={label} className="settings-tabs motion-tabs motion-tabs--pill">
        {tabs.map(({ id, label: tabLabel, icon: Icon }) => (
          <TabsTrigger
            key={id}
            value={id}
            id={getSettingsTabId(idPrefix, id)}
            aria-controls={id === value ? getSettingsTabPanelId(idPrefix, id) : undefined}
            className="settings-tab"
          >
            {Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}
            {tabLabel}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
