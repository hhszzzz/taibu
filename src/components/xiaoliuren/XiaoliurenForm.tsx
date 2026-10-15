'use client';
// 'use client'：受控输入、提交中状态与 Toast 提示。

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { requestBrowserJson } from '@/lib/browser-api';
import { toDateTimeLocalValue } from '@/lib/date-utils';
import type { XiaoliurenWebBundle } from '@/lib/divination/xiaoliuren';

const INPUT_CLASS = 'h-11 w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-[15px] text-foreground placeholder:text-foreground-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

interface XiaoliurenFormProps {
  /** 结果页「重新起课」沿用当前课的所问与时间（`YYYY-MM-DDTHH:mm`）；入口页缺省为空问与当前时间。 */
  initialQuestion?: string;
  initialDate?: string;
  submitLabel: string;
  submitIcon?: ReactNode;
  /** 起课成功后的去向由页面决定（入口页跳转结果页，结果页原地换课）。 */
  onCalculated: (bundle: XiaoliurenWebBundle) => void;
  /** display 断点类，默认 `flex`；结果页仅桌面端展示时传 `hidden lg:flex`。 */
  displayClassName?: string;
}

/** 小六壬起课表单：占问事项 + 起课时间，按本地墙上时间换算农历后由服务端排课。 */
export function XiaoliurenForm({ initialQuestion = '', initialDate, submitLabel, submitIcon, onCalculated, displayClassName = 'flex' }: XiaoliurenFormProps) {
  const { showToast } = useToast();
  const fieldId = useId();
  const [question, setQuestion] = useState(initialQuestion);
  const [date, setDate] = useState(() => initialDate || toDateTimeLocalValue());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      showToast('error', '请填写占问事项');
      return;
    }
    if (!date) {
      showToast('error', '请选择起课时间');
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await requestBrowserJson<XiaoliurenWebBundle>('/api/xiaoliuren', {
        method: 'POST',
        body: JSON.stringify({ action: 'calculate', date, question: trimmedQuestion }),
      });
      if (response.error || !response.data) {
        showToast('error', response.error?.message || '起课失败，请检查输入');
        return;
      }
      onCalculated(response.data);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '起课失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      aria-label="起课"
      noValidate
      onSubmit={(event) => { void handleSubmit(event); }}
      className={`${displayClassName} flex-wrap items-end gap-3.5 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:p-5`}
    >
      <div className="flex min-w-0 flex-[999_1_320px] flex-col gap-1.5">
        <label htmlFor={`${fieldId}-question`} className="text-sm font-medium">占问事项</label>
        <input
          id={`${fieldId}-question`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：今天适合签约吗？"
          className={INPUT_CLASS}
        />
      </div>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
        <label htmlFor={`${fieldId}-date`} className="text-sm font-medium">起课时间</label>
        <input
          id={`${fieldId}-date`}
          type="datetime-local"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={INPUT_CLASS}
        />
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-[22px] text-[15px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
      >
        {isSubmitting ? <><SoundWaveLoader variant="inline" /><span>正在起课</span></> : <>{submitIcon}{submitLabel}</>}
      </button>
      <span className="basis-full text-xs text-foreground-secondary">按本地墙上时间换算农历；闰月会在结果中明确标注。</span>
    </form>
  );
}
