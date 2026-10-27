import "server-only";
import { openSecret, sealSecret, type SealedSecret } from "@/lib/crypto/secret-box.server";

export type EncryptedAgentCredential = SealedSecret;

/** The deployment's 32-byte master key; other secret families derive their own keys from it. */
export function agentCredentialKey() {
  const value = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
  const key = Buffer.from(value ?? "", "base64");
  if (!value || key.length !== 32 || key.toString("base64") !== value)
    throw new Error("AGENT_CREDENTIAL_KEY_NOT_CONFIGURED");
  return key;
}
export function encryptAgentCredential(
  secret: string,
  userId: string,
  runId: string,
): EncryptedAgentCredential {
  return sealSecret(agentCredentialKey(), secret, `taibu-agent:v1:${userId}:${runId}`);
}
export function decryptAgentCredential(
  value: EncryptedAgentCredential,
  userId: string,
  runId: string,
) {
  if (value.version !== 1)
    throw new Error("AGENT_CREDENTIAL_VERSION_UNSUPPORTED");
  return openSecret(agentCredentialKey(), value, `taibu-agent:v1:${userId}:${runId}`);
}
