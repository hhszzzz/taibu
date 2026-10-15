'use client';
// 'use client'：起课结果写入 sessionStorage 后跳转结果页（需要 useRouter 与回调）。

import { useCallback } from 'react';
import { Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';
import { XiaoliurenForm } from '@/components/xiaoliuren/XiaoliurenForm';
import { XiaoliurenPalm } from '@/components/xiaoliuren/XiaoliurenPalm';
import { writeSessionJSON } from '@/lib/cache/session-storage';
import type { XiaoliurenWebBundle } from '@/lib/divination/xiaoliuren';

const COUNTING_STEPS = [
  { title: '月上起', description: '从食指根节「大安」起数，顺时针数到所占农历月。' },
  { title: '日上落', description: '从月上落宫起数，顺数到所占农历日。' },
  { title: '时上落', description: '从日上落宫起数，顺数到所占时辰，即为最终落宫。' },
] as const;

export default function XiaoliurenPage() {
  const router = useRouter();

  const handleCalculated = useCallback((bundle: XiaoliurenWebBundle) => {
    writeSessionJSON('xiaoliuren_result', { resultData: bundle });
    router.push('/xiaoliuren/result');
  }, [router]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-3 px-4 pt-4 pb-8 sm:px-8 lg:gap-7 lg:pt-12 lg:pb-16">
        <header className="hidden flex-col gap-2 lg:flex">
          <h1 className="font-display text-[34px] font-normal leading-tight">小六壬</h1>
          <p className="text-[15px] text-foreground-secondary">以左手食、中、无名三指六节为六宫，按农历月、日、时三步掐数落宫。</p>
        </header>

        <XiaoliurenForm submitLabel="开始起课" submitIcon={<Play className="h-4 w-4" />} onCalculated={handleCalculated} />

        <section aria-label="掌诀说明" className="flex flex-wrap items-center gap-6 rounded-[18px] border-[0.5px] border-border bg-surface px-4 py-5 sm:px-6">
          <div className="flex min-w-0 flex-[1_1_300px] justify-center">
            <XiaoliurenPalm className="max-w-[340px]" />
          </div>
          <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
            <h2 className="font-display text-xl">掐指三步</h2>
            <ol className="flex flex-col gap-3">
              {COUNTING_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs text-background">{index + 1}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{step.title}</div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-secondary">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="border-t-[0.5px] border-border pt-3 text-xs leading-relaxed text-foreground-secondary">
              左手掌心朝己，食指根节起大安，顺时针经三指指尖至无名指根，回中指根为一周；拇指逐节掐数。
            </p>
          </div>
        </section>
      </div>
      <HistoryDrawer type="xiaoliuren" />
    </div>
  );
}
