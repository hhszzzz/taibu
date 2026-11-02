import 'server-only';
import { deriveSecretKey, isSealedSecret, openSecret, sealSecret, type SealedSecret } from '@/lib/crypto/secret-box.server';
import { agentCredentialKey } from '@/lib/agent/credentials.server';
import { byokKeyHint } from './config';

/**
 * A stored own-model key is sealed under its own key and bound to its owner, its connection and the connection's host:
 * copied to another row, or left behind after the address moved to another host, it does not open. Keys an Agent task
 * carries from a browser are sealed to the task and dropped when it ends.
 */
const BYOK_SECRET_INFO = 'taibu-byok-secrets:v1';
const BYOK_RUN_SECRET_INFO = 'taibu-byok-run-keys:v1';

export type ByokKeyScope = { userId: string; connectionId: string; host: string };

/** Thrown when a stored key does not open: tampered, moved, or sealed under another master key. */
export class ByokKeyError extends Error {
  constructor() {
    super('BYOK_KEY_INVALID');
  }
}

const storedAad = (scope: ByokKeyScope) => `taibu-byok:v1:${scope.userId}:${scope.connectionId}:${scope.host}`;
const runAad = (userId: string, runId: string, connectionId: string) => `taibu-byok-run:v1:${userId}:${runId}:${connectionId}`;

export function sealByokKey(scope: ByokKeyScope, key: string): { secret: SealedSecret; hint: string } {
  return { secret: sealSecret(deriveSecretKey(agentCredentialKey(), BYOK_SECRET_INFO), key, storedAad(scope)), hint: byokKeyHint(key) };
}

export function openByokKey(scope: ByokKeyScope, secret: unknown): string {
  if (!isSealedSecret(secret)) throw new ByokKeyError();
  try {
    return openSecret(deriveSecretKey(agentCredentialKey(), BYOK_SECRET_INFO), secret, storedAad(scope));
  } catch {
    throw new ByokKeyError();
  }
}

/** Browser keys a task carries, by connection; the shape the task's credential row holds. */
export type ByokRunKeys = { version: 2; keys: Record<string, SealedSecret> };

export function sealByokRunKeys(userId: string, runId: string, keys: Record<string, string>): ByokRunKeys | null {
  const entries = Object.entries(keys);
  if (!entries.length) return null;
  const key = deriveSecretKey(agentCredentialKey(), BYOK_RUN_SECRET_INFO);
  return { version: 2, keys: Object.fromEntries(entries.map(([connectionId, value]) => [connectionId, sealSecret(key, value, runAad(userId, runId, connectionId))])) };
}

/** The keys a task carries; a value that does not open is left out, and the call that needs it fails on its own. */
export function openByokRunKeys(userId: string, runId: string, stored: unknown): Record<string, string> {
  if (!stored || typeof stored !== 'object' || (stored as { version?: unknown }).version !== 2) return {};
  const sealed = (stored as { keys?: unknown }).keys;
  if (!sealed || typeof sealed !== 'object' || Array.isArray(sealed)) return {};
  const key = deriveSecretKey(agentCredentialKey(), BYOK_RUN_SECRET_INFO);
  const opened: Record<string, string> = {};
  for (const [connectionId, value] of Object.entries(sealed)) {
    if (!isSealedSecret(value)) continue;
    try {
      opened[connectionId] = openSecret(key, value, runAad(userId, runId, connectionId));
    } catch {
      // Left out: the request that needs this key reports the missing key.
    }
  }
  return opened;
}
