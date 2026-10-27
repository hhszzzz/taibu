"use client";
// 模型正文的实时增量：只用来显示，落库与历史仍以快照为准。
import { useSyncExternalStore } from "react";

type Tail = { seq: number; text: string };

const tails = new Map<string, Tail>();
const listeners = new Set<() => void>();
let scheduled = false;

const emit = () => {
  for (const listener of listeners) listener();
};

/** 一帧内多次到达的增量合并成一次渲染，避免每个 token 重排一次 Markdown。 */
function schedule() {
  if (scheduled) return;
  scheduled = true;
  const flush = () => {
    scheduled = false;
    emit();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
  else setTimeout(flush, 16);
}

export function pushAgentTail(runId: string, seq: number, text: string) {
  const current = tails.get(runId);
  if (current && seq <= current.seq) return;
  tails.set(runId, { seq, text });
  schedule();
}

export function clearAgentTail(runId: string) {
  if (tails.delete(runId)) emit();
}

export function clearAgentTails() {
  if (!tails.size) return;
  tails.clear();
  emit();
}

/** 非 React 读取（测试与回调里用）。 */
export function readAgentTail(runId: string) {
  return tails.get(runId)?.text ?? "";
}

export function useAgentTailText(runId: string) {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tails.get(runId)?.text ?? "",
    () => "",
  );
}
