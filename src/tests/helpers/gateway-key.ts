import { randomBytes } from 'node:crypto';
import { sealGatewayApiKey } from '../../lib/ai/gateway-secrets.server';

// The master key is read when a key is sealed, so setting it here covers every import order.
process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

/** A gateway reference with a key sealed to it, as a model source carries it after loading from the catalog. */
export function sealedGateway(gatewayId: string, apiKey = 'gateway-fixture-key') {
  return { gatewayId, apiKeySecret: sealGatewayApiKey(gatewayId, apiKey).secret };
}
