import type { LiuyaoCanonicalJSON } from 'taibu-core/liuyao';

/**
 * 四柱干支条：每柱附旬空。
 * 宽容器为四张小卡，日柱（断卦判空亡的主依据）以黏土色强调；窄容器（手机 / 对话命盘）收拢为燕麦色整条。
 */
export function LiuyaoPillars({ pillars }: { pillars: LiuyaoCanonicalJSON['干支时间'] }) {
  if (pillars.length === 0) return null;
  return (
    <div className="@container">
      <div role="list" aria-label="四柱干支与旬空" className="grid grid-cols-4 rounded-xl bg-panel py-2.5 @2xl:gap-2 @2xl:bg-transparent @2xl:py-0">
        {pillars.map((pillar) => {
          const isDay = pillar.柱 === '日';
          return (
            <div
              key={pillar.柱}
              role="listitem"
              className={`flex min-w-0 flex-col items-center gap-px @2xl:flex-row @2xl:items-baseline @2xl:justify-between @2xl:rounded-xl @2xl:bg-surface @2xl:px-3.5 @2xl:py-3 ${isDay ? '@2xl:border @2xl:border-accent/50' : '@2xl:border-[0.5px] @2xl:border-border'}`}
            >
              <div className="flex flex-col items-center @2xl:flex-row @2xl:items-baseline @2xl:gap-1.5">
                <span className={`text-[0.6875rem] text-foreground-secondary @2xl:text-xs ${isDay ? '@2xl:text-accent-strong' : ''}`}>{pillar.柱}</span>
                <span className="font-display text-[1.0625rem] @2xl:text-lg">{pillar.干支}</span>
              </div>
              <span className={`text-[10.5px] text-foreground-tertiary @2xl:text-xs ${isDay ? '@2xl:text-accent-strong' : '@2xl:text-foreground-secondary'}`}>
                空 {pillar.空亡.length > 0 ? pillar.空亡.join('') : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
