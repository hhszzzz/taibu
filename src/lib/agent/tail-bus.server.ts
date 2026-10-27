import 'server-only';
import { createSubscriber, getRedisClient } from '@/lib/redis.server';

/**
 * 答案正文的增量通道：worker 边生成边发，浏览器直接追加，只用于显示、不落库。
 * 断线或落后时以已提交的快照为准（快照永远更权威）；Redis 不可用时静默退化为按快照刷新。
 */
export type AgentTailFrame = { seq: number; text: string };

const CHANNEL = 'taibu:agent:tail';

const channelOf = (runId: string) => `${CHANNEL}:${runId}`;

export async function publishAgentTextDelta(runId: string, seq: number, text: string): Promise<void> {
    if (!text) return;
    try {
        await getRedisClient().publish(channelOf(runId), JSON.stringify({ seq, text } satisfies AgentTailFrame));
    } catch {
        /* 增量只是锦上添花：丢了就等下一次快照 */
    }
}

export function subscribeAgentTextDelta(runId: string, onFrame: (frame: AgentTailFrame) => void): () => void {
    let subscriber: ReturnType<typeof createSubscriber>;
    try {
        subscriber = createSubscriber();
    } catch {
        return () => {};
    }
    subscriber.on('error', () => {});
    void subscriber.subscribe(channelOf(runId)).catch(() => {});
    subscriber.on('message', (_channel, payload) => {
        try {
            const frame = JSON.parse(payload) as AgentTailFrame;
            if (Number.isSafeInteger(frame.seq) && typeof frame.text === 'string') onFrame(frame);
        } catch {
            /* ignore malformed frames */
        }
    });
    return () => {
        void subscriber.unsubscribe(channelOf(runId)).catch(() => {});
        subscriber.disconnect();
    };
}
