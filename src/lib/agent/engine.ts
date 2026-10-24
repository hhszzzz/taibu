import type { AgentCheckpoint } from './types';

/** Only the pinned runtime may execute a checkpoint; upgrades retire older runs. */
export const AGENT_ENGINE = "pi-durable/1.4.0";

export function isCurrentAgentCheckpoint(value: unknown): value is AgentCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const checkpoint = value as Partial<AgentCheckpoint>;
  return checkpoint.version === 2 && checkpoint.durable?.engine === AGENT_ENGINE;
}
