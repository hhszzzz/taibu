'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { writeSessionJSON } from '@/lib/cache/session-storage';
import { requestBrowserJson } from '@/lib/browser-api';
import { toDateTimeLocalValue } from '@/lib/date-utils';
import type { MeihuaInput, MeihuaWebBundle, WebMeihuaMethod } from '@/lib/divination/meihua';

const METHOD_OPTIONS: Array<{ id: WebMeihuaMethod; label: string; hint: string }> = [
  { id: 'time', label: '时间起卦', hint: '按年月日时取数' },
  { id: 'text_split', label: '文字起卦', hint: '字数、句意或笔画' },
  { id: 'number_pair', label: '两数起卦', hint: '输入上下卦数字' },
  { id: 'number_triplet', label: '三数起卦', hint: '输入上下卦与动爻' },
];

const INPUT_CLASS = 'h-11 w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 text-[15px] text-foreground placeholder:text-foreground-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?；;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function MeihuaPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [question, setQuestion] = useState('');
  const [date, setDate] = useState(() => toDateTimeLocalValue());
  const [method, setMethod] = useState<WebMeihuaMethod>('time');
  const [text, setText] = useState('');
  const [multiSentenceStrategy, setMultiSentenceStrategy] = useState<'first' | 'last'>('first');
  const [leftStrokeCount, setLeftStrokeCount] = useState('');
  const [rightStrokeCount, setRightStrokeCount] = useState('');
  const [numbers, setNumbers] = useState(['', '', '']);
  const [isLoading, setIsLoading] = useState(false);

  const sentences = useMemo(() => splitSentences(text), [text]);
  const isSingleCharacter = method === 'text_split' && Array.from(text.trim()).length === 1;

  const updateNumber = (index: number, value: string) => {
    setNumbers((previous) => previous.map((item, itemIndex) => itemIndex === index ? value : item));
  };

  const buildInput = (): MeihuaInput | null => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      showToast('error', '请填写占问事项');
      return null;
    }
    if (!date) {
      showToast('error', '请选择起卦时间');
      return null;
    }

    const input: MeihuaInput = { question: trimmedQuestion, date, method };
    if (method === 'text_split') {
      const trimmedText = text.trim();
      if (!trimmedText) {
        showToast('error', '请输入用于起卦的文字');
        return null;
      }
      input.text = trimmedText;
      if (isSingleCharacter) {
        const left = Number(leftStrokeCount);
        const right = Number(rightStrokeCount);
        if (!Number.isInteger(left) || left <= 0 || !Number.isInteger(right) || right <= 0) {
          showToast('error', '单字起卦需要填写左右半部笔画数');
          return null;
        }
        input.textSplitMode = 'stroke';
        input.leftStrokeCount = left;
        input.rightStrokeCount = right;
      } else if (sentences.length > 2) {
        input.multiSentenceStrategy = multiSentenceStrategy;
      }
    }
    if (method === 'number_pair' || method === 'number_triplet') {
      const count = method === 'number_pair' ? 2 : 3;
      const parsedNumbers = numbers.slice(0, count).map(Number);
      if (parsedNumbers.some((value) => !Number.isInteger(value) || value <= 0)) {
        showToast('error', `请填写 ${count} 个正整数`);
        return null;
      }
      input.numbers = parsedNumbers;
    }
    return input;
  };

  const handleCalculate = async () => {
    const input = buildInput();
    if (!input) return;
    setIsLoading(true);
    try {
      const response = await requestBrowserJson<MeihuaWebBundle>('/api/meihua', {
        method: 'POST',
        body: JSON.stringify({ action: 'calculate', input }),
      });
      if (response.error || !response.data) {
        showToast('error', response.error?.message || '起卦失败，请检查输入');
        return;
      }
      writeSessionJSON('meihua_result', { input, resultData: response.data });
      router.push('/meihua/result');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '起卦失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-5 sm:gap-7 sm:px-8 sm:py-12">
        <header className="hidden flex-col gap-2 lg:flex">
          <h1 className="font-display text-[34px] font-normal leading-tight">梅花易数</h1>
          <p className="text-[15px] text-foreground-secondary">以时间、文字或报数起卦，观察体用生克与卦象流转。</p>
        </header>

        <section className="flex flex-col gap-5 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:p-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex min-w-0 flex-[999_1_320px] flex-col gap-1.5">
              <label htmlFor="meihua-question" className="text-sm font-medium">占问事项</label>
              <input
                id="meihua-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="例如：这次合作能否顺利推进？"
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex min-w-0 flex-[1_1_250px] flex-col gap-1.5">
              <label htmlFor="meihua-date" className="text-sm font-medium">起卦时间</label>
              <div className="relative">
                <CalendarClock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-secondary" />
                <input
                  id="meihua-date"
                  type="datetime-local"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className={`${INPUT_CLASS} pl-10`}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="text-sm font-medium">起卦方式</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="梅花起卦方式">
              {METHOD_OPTIONS.map((option) => {
                const active = method === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMethod(option.id)}
                    aria-pressed={active}
                    className={`rounded-xl px-3.5 py-3 text-left transition-colors ${active ? 'bg-accent-soft ring-2 ring-inset ring-accent' : 'border-[0.5px] border-border-hover bg-surface hover:bg-background-secondary active:bg-background-tertiary'}`}
                  >
                    <span className={`block font-display text-[15px] ${active ? 'text-accent-strong' : ''}`}>{option.label}</span>
                    <span className="mt-1 block text-xs text-foreground-secondary">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {method === 'text_split' && (
            <div className="flex flex-col gap-4 border-t-[0.5px] border-border pt-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="meihua-text" className="text-sm font-medium">取卦文字</label>
                <textarea
                  id="meihua-text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={3}
                  placeholder="输入一个字、两句文字或一段来意"
                  className="w-full resize-y rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3.5 py-3 text-[15px] leading-relaxed text-foreground placeholder:text-foreground-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
              {isSingleCharacter && (
                <div className="grid grid-cols-2 gap-3">
                  {[['left-stroke', '左半部笔画', leftStrokeCount, setLeftStrokeCount], ['right-stroke', '右半部笔画', rightStrokeCount, setRightStrokeCount]].map(([id, label, value, setter]) => (
                    <label key={id as string} htmlFor={id as string} className="flex flex-col gap-1.5 text-[13px] text-foreground-secondary">
                      <span className="font-medium">{label as string}</span>
                      <input id={id as string} type="number" min={1} value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} className={INPUT_CLASS} />
                    </label>
                  ))}
                </div>
              )}
              {sentences.length > 2 && !isSingleCharacter && (
                <div className="flex flex-col gap-2">
                  <div className="text-[13px] font-medium text-foreground-secondary">多句取用</div>
                  <div className="inline-flex w-fit rounded-[10px] bg-background-secondary p-1" role="group" aria-label="多句取用方式">
                    {(['first', 'last'] as const).map((value) => (
                      <button key={value} type="button" aria-pressed={multiSentenceStrategy === value} onClick={() => setMultiSentenceStrategy(value)} className={`h-8 rounded-lg px-3.5 text-[13px] transition-colors ${multiSentenceStrategy === value ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                        {value === 'first' ? '取首句' : '取末句'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {(method === 'number_pair' || method === 'number_triplet') && (
            <div className="flex flex-col gap-2 border-t-[0.5px] border-border pt-5">
              <div className="text-sm font-medium">报数</div>
              <div className={`grid gap-3 ${method === 'number_pair' ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {numbers.slice(0, method === 'number_pair' ? 2 : 3).map((value, index) => (
                  <label key={index} htmlFor={`meihua-number-${index}`} className="flex flex-col gap-1.5 text-[13px] text-foreground-secondary">
                    <span className="font-medium">{index === 0 ? '上卦' : index === 1 ? '下卦' : '动爻'}</span>
                    <input id={`meihua-number-${index}`} type="number" min={1} value={value} onChange={(event) => updateNumber(index, event.target.value)} className={INPUT_CLASS} />
                  </label>
                ))}
              </div>
            </div>
          )}

          <button type="button" onClick={() => void handleCalculate()} disabled={isLoading} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50">
            {isLoading ? <><SoundWaveLoader variant="inline" /><span>正在起卦</span></> : <><Play className="h-4 w-4" />开始起卦</>}
          </button>
        </section>
      </div>
      <HistoryDrawer type="meihua" />
    </div>
  );
}
