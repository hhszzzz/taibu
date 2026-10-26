import 'server-only';
import { deriveSecretKey, isSealedSecret, openSecret, sealSecret, type SealedSecret } from '@/lib/crypto/secret-box.server';
import { agentCredentialKey } from '../credentials.server';

/**
 * MCP secrets (credential headers and query parameters) are sealed under their own key and bound to the server row,
 * its owner and the field: a value copied to another server, user or field does not open.
 */
const MCP_SECRET_INFO = 'taibu-mcp-secrets:v1';

export type McpSecretKind = 'header' | 'query';
export type McpSecretScope = { serverId: string; ownerId: string | null };
export type SealedSecretMap = Record<string, SealedSecret>;

function mcpSecretKey() {
  return deriveSecretKey(agentCredentialKey(), MCP_SECRET_INFO);
}

function additionalData(scope: McpSecretScope, kind: McpSecretKind, name: string) {
  return `taibu-mcp:v1:${scope.ownerId ? `user:${scope.ownerId}` : 'platform'}:${scope.serverId}:${kind}:${name}`;
}

/** The stored map with only well-formed entries; anything else in the column is ignored. */
export function sealedEntries(value: unknown): SealedSecretMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, sealed]) => isSealedSecret(sealed))) as SealedSecretMap;
}

/** Applies write-only changes to a stored map: a value is sealed afresh, null removes, absent names are kept. */
export function applyMcpSecretChanges(
  scope: McpSecretScope, kind: McpSecretKind, current: unknown, changes: Record<string, string | null> | undefined,
): SealedSecretMap {
  const next = sealedEntries(current);
  if (!changes) return next;
  const key = Object.values(changes).some(value => value !== null) ? mcpSecretKey() : undefined;
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) delete next[name];
    else next[name] = sealSecret(key!, value, additionalData(scope, kind, name));
  }
  return next;
}

/** Plaintext for one connection. Throws when a value was tampered with or sealed for another row. */
export function openMcpSecrets(scope: McpSecretScope, kind: McpSecretKind, stored: unknown): Record<string, string> {
  const entries = Object.entries(sealedEntries(stored));
  if (!entries.length) return {};
  const key = mcpSecretKey();
  try {
    return Object.fromEntries(entries.map(([name, sealed]) => [name, openSecret(key, sealed, additionalData(scope, kind, name))]));
  } catch {
    throw new Error('AGENT_MCP_SECRET_INVALID');
  }
}
