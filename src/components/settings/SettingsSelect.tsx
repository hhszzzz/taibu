'use client';
// 需要 useState/useRef/useLayoutEffect 管理浮层位置与键盘选择

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './settings-select.css';

export type SettingsSelectOption<T extends string | number> = {
  value: T;
  label: string;
  disabled?: boolean;
};

/**
 * 设置页下拉选择：按钮 + 浮层列表。
 * 原生 select 在深色/圆角/长选项上不一致，这里统一外观并保留键盘操作。
 */
export function SettingsSelect<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  describedBy,
  disabled = false,
  className = '',
  placeholder = '请选择',
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly SettingsSelectOption<T>[];
  ariaLabel?: string;
  id?: string;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const selectedIndex = options.findIndex(option => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 176), window.innerWidth - 16);
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 220 && rect.top > spaceBelow;
    setPosition(above
      ? { bottom: window.innerHeight - rect.top + 4, left, width }
      : { top: rect.bottom + 4, left, width });
  };

  const openList = () => {
    place();
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (step: number) => {
    if (!options.length) return;
    let next = activeIndex;
    for (let count = 0; count < options.length; count += 1) {
      next = (next + step + options.length) % options.length;
      if (!options[next].disabled) break;
    }
    setActiveIndex(next);
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        className={`settings-select settings-combobox${className ? ` ${className}` : ''}`}
        onClick={() => { if (open) setOpen(false); else openList(); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { openList(); return; }
            move(event.key === 'ArrowDown' ? 1 : -1);
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open) choose(activeIndex);
            else openList();
            return;
          }
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span className={`settings-combobox-value${selected ? '' : ' is-placeholder'}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className="settings-combobox-icon" aria-hidden="true" />
      </button>
      {open && position ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          className="settings-combobox-popover"
          style={{ top: position.top, bottom: position.bottom, left: position.left, width: position.width }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(event.key === 'ArrowDown' ? 1 : -1);
              return;
            }
            if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
              return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              choose(activeIndex);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
              return;
            }
            if (event.key === 'Tab') setOpen(false);
          }}
        >
          {options.map((option, index) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-active={index === activeIndex || undefined}
              className="settings-combobox-option"
              onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} className="settings-combobox-check" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
