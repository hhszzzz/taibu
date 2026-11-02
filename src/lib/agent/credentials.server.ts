import "server-only";

/** The deployment's 32-byte master key; other secret families derive their own keys from it. */
export function agentCredentialKey() {
  const value = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
  const key = Buffer.from(value ?? "", "base64");
  if (!value || key.length !== 32 || key.toString("base64") !== value)
    throw new Error("AGENT_CREDENTIAL_KEY_NOT_CONFIGURED");
  return key;
}
