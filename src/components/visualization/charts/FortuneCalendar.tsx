/**
 * Fortune Calendar Heatmap
 *
 * Calendar heatmap like GitHub contributions, showing daily fortune scores.
 * Uses pure CSS Grid layout with Tailwind classes.
 * Features colored day cells, click-to-expand details, month summary,
 * and month navigation.
 */
'use client';

import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { FortuneCalendarData } from '@/lib/visualization/chart-types';
import { getScoreColor } from '@/lib/visualization/chart-theme';
import { useChartEntrance, CHART_ENTRANCE_BASE, CHART_ENTRANCE_ACTIVE } from '@/components/visualization/shared/useChartEntrance';
import { useSwipe } from '@/components/visualization/shared/useSwipe';

// ===== Types =====

interface FortuneCalendarProps {
  data: FortuneCalendarData;
  compact?: boolean;
  mode?: 'month' | 'year';
  onMonthChange?: (year: number, month: number) => void;
}

interface DayCell {
  date: number;
  overallScore: number;
  level: string;
  highlight: string | null;
  isEmpty: boolean;
}

// ===== Constants =====

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

// Score-to-color mapping for day cells
function getScoreBgClass(score: number): string {
  if (score >= 80) return 'bg-green-500 dark:bg-green-600';
  if (score >= 65) return 'bg-emerald-400 dark:bg-emerald-500';
  if (score >= 50) return 'bg-amber-400 dark:bg-amber-500';
  if (score >= 35) return 'bg-orange-400 dark:bg-orange-500';
  return 'bg-red-400 dark:bg-red-500';
}

function getScoreTextClass(score: number): string {
  if (score >= 50) return 'text-white';
  return 'text-white';
}

function getLevelColor(level: string): string {
  switch (level) {
    case '大吉': return '#16a34a';
    case '吉': return '#22c55e';
    case '中吉': return '#84cc16';
    case '平': return '#f59e0b';
    case '小凶': return '#f97316';
    case '凶': return '#ef4444';
    default: return '#9ca3af';
  }
}

// ===== Day Detail Popup =====

function DayDetailPopup({
  day,
  year,
  month,
  onClose,
}: {
  day: DayCell;
  year: number;
  month: number;
  onClose: () => void;
}) {
  return (
    <div className="absolute z-20 bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl p-3 shadow-xl min-w-[180px] -translate-x-1/2 left-1/2 top-full mt-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-[var(--color-foreground)]">
          {year}年{month}月{day.date}日
        </span>
        <Button unstyled
          onClick={onClose}
          className="p-0.5 rounded hover:bg-[var(--color-background-secondary)] text-[var(--color-foreground-secondary)]"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Fortune Level Badge */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-2 py-0.5 text-xs font-medium rounded-full text-white"
          style={{ backgroundColor: getLevelColor(day.level) }}
        >
          {day.level}
        </span>
        <span className="text-sm font-bold tabular-nums" style={{ color: getScoreColor(day.overallScore) }}>
          {day.overallScore}分
        </span>
      </div>

      {/* Highlight Tag */}
      {day.highlight && (
        <div className="text-xs text-[var(--color-foreground-secondary)] bg-[var(--color-background-secondary)] rounded-md px-2 py-1 mb-2">
          {day.highlight}
        </div>
      )}

      {/* Score Bar */}
      <div className="w-full h-1.5 bg-[var(--color-background-secondary)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${day.overallScore}%`,
            backgroundColor: getScoreColor(day.overallScore),
          }}
        />
      </div>
    </div>
  );
}

// ===== Main Component =====

function FortuneCalendarInner({
  data,
  compact = false,
  // mode reserved for future year view
  onMonthChange,
}: FortuneCalendarProps) {
  const { ref, entered } = useChartEntrance();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const { year, month, days, monthSummary } = data.data;

  // Build the calendar grid
  const calendarGrid = useMemo((): DayCell[][] => {
    // First day of month: 0=Sunday, 1=Monday, ...
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    // Build day map for quick lookup
    const dayMap = new Map<number, (typeof days)[0]>();
    for (const d of days) {
      dayMap.set(d.date, d);
    }

    const rows: DayCell[][] = [];
    let currentRow: DayCell[] = [];

    // Padding cells before first day
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentRow.push({
        date: 0,
        overallScore: 0,
        level: '',
        highlight: null,
        isEmpty: true,
      });
    }

    // Fill in days
    for (let day = 1; day <= daysInMonth; day++) {
      const dayData = dayMap.get(day);
      currentRow.push({
        date: day,
        overallScore: dayData?.overallScore ?? 0,
        level: dayData?.level ?? '平',
        highlight: dayData?.highlight ?? null,
        isEmpty: false,
      });

      if (currentRow.length === 7) {
        rows.push(currentRow);
        currentRow = [];
      }
    }

    // Padding cells after last day
    if (currentRow.length > 0) {
      while (currentRow.length < 7) {
        currentRow.push({
          date: 0,
          overallScore: 0,
          level: '',
          highlight: null,
          isEmpty: true,
        });
      }
      rows.push(currentRow);
    }

    return rows;
  }, [year, month, days]);

  // Check if a day is "today"
  const today = useMemo(() => {
    const now = new Date();
    if (now.getFullYear() === year && now.getMonth() + 1 === month) {
      return now.getDate();
    }
    return null;
  }, [year, month]);

  const handleDayClick = useCallback(
    (date: number) => {
      if (compact) return;
      setSelectedDay((prev) => (prev === date ? null : date));
    },
    [compact]
  );

  const handlePrevMonth = useCallback(() => {
    if (!onMonthChange) return;
    if (month === 1) {
      onMonthChange(year - 1, 12);
    } else {
      onMonthChange(year, month - 1);
    }
  }, [onMonthChange, year, month]);

  const handleNextMonth = useCallback(() => {
    if (!onMonthChange) return;
    if (month === 12) {
      onMonthChange(year + 1, 1);
    } else {
      onMonthChange(year, month + 1);
    }
  }, [onMonthChange, year, month]);

  const swipeRef = useSwipe({
    onSwipeLeft: handleNextMonth,
    onSwipeRight: handlePrevMonth,
  });

  const cellSize = compact ? 'w-7 h-7' : 'w-9 h-9 sm:w-10 sm:h-10';
  const fontSize = compact ? 'text-[10px]' : 'text-xs';

  return (
    <div ref={ref} className={`space-y-3 ${CHART_ENTRANCE_BASE} ${entered ? CHART_ENTRANCE_ACTIVE : ''}`}>
      {/* Title + Month Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {data.title && (
            <h3 className="text-base font-bold text-[var(--color-foreground)]">{data.title}</h3>
          )}
        </div>

        {onMonthChange && (
          <div className="flex items-center gap-1">
            <Button unstyled
              onClick={handlePrevMonth}
              className="p-1 rounded-md hover:bg-[var(--color-background-secondary)] text-[var(--color-foreground-secondary)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium text-[var(--color-foreground)] min-w-[90px] text-center">
              {year}年{month}月
            </span>
            <Button unstyled
              onClick={handleNextMonth}
              className="p-1 rounded-md hover:bg-[var(--color-background-secondary)] text-[var(--color-foreground-secondary)] transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {!onMonthChange && (
          <span className="text-sm text-[var(--color-foreground-secondary)]">
            {year}年{month}月
          </span>
        )}
      </div>

      {/* Calendar Grid */}
      <div ref={swipeRef} className="bg-[var(--color-background-secondary)]/30 border border-[var(--color-border)]/50 rounded-2xl p-3">
        {/* Weekday Header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className={`text-center ${fontSize} font-medium text-[var(--color-foreground-tertiary)] py-1`}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Day Rows */}
        {calendarGrid.map((row, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-7 gap-1">
            {row.map((cell, colIdx) => {
              if (cell.isEmpty) {
                return (
                  <div key={`empty-${rowIdx}-${colIdx}`} className={cellSize} />
                );
              }

              const isToday = cell.date === today;
              const isSelected = cell.date === selectedDay;
              const hasHighlight = !!cell.highlight;

              return (
                <div key={cell.date} className="relative">
                  <Button unstyled
                    onClick={() => handleDayClick(cell.date)}
                    className={`
                      ${cellSize} rounded-lg flex flex-col items-center justify-center
                      transition-all duration-200 relative
                      ${getScoreBgClass(cell.overallScore)}
                      ${getScoreTextClass(cell.overallScore)}
                      ${isToday ? 'ring-2 ring-[var(--color-accent,#D4AF37)] ring-offset-1 ring-offset-[var(--color-background)]' : ''}
                      ${isSelected ? 'scale-110 shadow-lg z-10' : 'hover:scale-105'}
                      ${compact ? 'cursor-default' : 'cursor-pointer'}
                    `}
                    disabled={compact}
                  >
                    <span className={`${fontSize} font-medium leading-none`}>
                      {cell.date}
                    </span>

                    {/* Highlight dot */}
                    {hasHighlight && (
                      <div className="w-1 h-1 rounded-full bg-background/80 mt-0.5" />
                    )}
                  </Button>

                  {/* Day Detail Popup */}
                  {isSelected && !compact && (
                    <DayDetailPopup
                      day={cell}
                      year={year}
                      month={month}
                      onClose={() => setSelectedDay(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Color Legend */}
      <div className="flex items-center justify-center gap-2 text-[10px] text-[var(--color-foreground-secondary)]">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-400 dark:bg-red-500" />
          <span>凶</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-orange-400 dark:bg-orange-500" />
          <span>小凶</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-amber-400 dark:bg-amber-500" />
          <span>平</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-emerald-400 dark:bg-emerald-500" />
          <span>吉</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-500 dark:bg-green-600" />
          <span>大吉</span>
        </div>
      </div>

      {/* Month Summary */}
      {!compact && monthSummary && (
        <div className="space-y-3">
          {/* Stats Row */}
          <div className="flex items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-[var(--color-foreground-secondary)]">吉日</span>
              <span className="font-bold text-green-500">{monthSummary.luckyDayCount}</span>
              <span className="text-[var(--color-foreground-tertiary)]">天</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-[var(--color-foreground-secondary)]">平日</span>
              <span className="font-bold text-amber-500">{monthSummary.normalDayCount}</span>
              <span className="text-[var(--color-foreground-tertiary)]">天</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-[var(--color-foreground-secondary)]">注意</span>
              <span className="font-bold text-red-400">{monthSummary.cautionDayCount}</span>
              <span className="text-[var(--color-foreground-tertiary)]">天</span>
            </div>
          </div>

          {/* Best Days & Caution Days */}
          <div className="flex flex-col sm:flex-row gap-2">
            {monthSummary.bestDays.length > 0 && (
              <div className="flex-1 bg-green-500/5 border border-green-500/10 rounded-xl p-2.5">
                <div className="text-xs font-medium text-green-600 dark:text-green-400 mb-1.5">
                  最佳日期
                </div>
                <div className="flex flex-wrap gap-1">
                  {monthSummary.bestDays.map((day) => (
                    <span
                      key={day}
                      className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-600 dark:text-green-400"
                    >
                      {day}日
                    </span>
                  ))}
                </div>
              </div>
            )}

            {monthSummary.cautionDays.length > 0 && (
              <div className="flex-1 bg-red-500/5 border border-red-500/10 rounded-xl p-2.5">
                <div className="text-xs font-medium text-red-500 dark:text-red-400 mb-1.5">
                  需注意日期
                </div>
                <div className="flex flex-wrap gap-1">
                  {monthSummary.cautionDays.map((day) => (
                    <span
                      key={day}
                      className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-500/10 text-red-500 dark:text-red-400"
                    >
                      {day}日
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const FortuneCalendar = FortuneCalendarInner;
export default FortuneCalendar;
