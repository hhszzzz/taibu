/**
 * 「问问太卜」：带上当天黄历与运势进入 AI 对话，不在页内单开问答。
 */
import { BrandMark } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/Button';

interface DailyAskCardProps {
    dateLabel: string;
    personalized: boolean;
    onAsk: () => void;
}

export function DailyAskCard({ dateLabel, personalized, onAsk }: DailyAskCardProps) {
    return (
        <section aria-labelledby="daily-ask-title" className="flex h-full min-w-0 flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-panel p-4 lg:p-[22px]">
            <div className="flex items-center gap-2.5">
                <BrandMark className="size-[30px] shrink-0 text-foreground" />
                <h2 id="daily-ask-title" className="font-display text-lg">问问太卜</h2>
            </div>
            <p className="text-sm leading-relaxed text-foreground-secondary">
                带上{dateLabel}的黄历{personalized ? '与你的当日运势' : ''}进入 AI 对话，由太卜解答这一天的安排与注意事项。
            </p>
            <Button unstyled type="button" onClick={onAsk}
                className="mt-auto inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
                问太卜
            </Button>
        </section>
    );
}
