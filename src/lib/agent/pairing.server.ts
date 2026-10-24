import 'server-only';
import type { ToolInputSchema, ToolSchema } from 'taibu-core/mcp';
import type { AgentRunRow, AgentStore } from './store.server';
import { chartInputOf } from './drilldown.server';

/** The two people of a pairing, as Core's bazi_hepan names them. */
export const AGENT_PAIRING_SIDES = ['a', 'b'] as const;

const REFERENCE: ToolSchema = {
  type: 'string', minLength: 1, maxLength: 64,
  description: '这一方已排好的八字：artifact:成果ID，或 read_user_data 返回的八字命盘引用。传了就不再传出生信息，只可另给 name',
};

/**
 * bazi_hepan's Agent parameters: either person may be a bazi chart of this conversation or a saved one instead of
 * birth data, rebuilt by the server as a drilldown's is, so the model never copies a chart's birth time by hand.
 */
export function pairingParameters(schema: ToolInputSchema): ToolInputSchema {
  // Core requires the birth fields; here a reference may stand in for them, so nothing is required.
  const person = (key: typeof AGENT_PAIRING_SIDES[number]): ToolSchema => {
    const { type, additionalProperties, description, properties } = schema.properties[key];
    return { type, additionalProperties, description: `${description}；已有这一方的八字时只传 reference（可另给 name）`, properties: { reference: REFERENCE, ...properties } };
  };
  return { ...schema, properties: { ...schema.properties, a: person('a'), b: person('b') } };
}

/**
 * Core's bazi_hepan input: a referenced person's birth data rebuilt from the chart, keeping only the name the model
 * gave. Values equal to the schema's defaults were filled in by argument preparation, not given by the model.
 */
export async function resolvePairing(store: AgentStore, run: AgentRunRow, args: Record<string, unknown>, schema: ToolInputSchema) {
  const people = await Promise.all(AGENT_PAIRING_SIDES.map(async key => {
    const person = args[key] && typeof args[key] === 'object' ? args[key] as Record<string, unknown> : {};
    const { reference, name, ...birth } = person;
    if (reference === undefined) return person;
    const fields = schema.properties[key].properties ?? {};
    const given = Object.keys(birth).filter(field => birth[field] !== fields[field]?.default);
    if (given.length) throw new Error(`${key} 已引用命盘，不能再传出生信息（${given.join('、')}）；要改出生信息请重新排盘`);
    const { input } = await chartInputOf(store, run, reference, 'bazi', '合盘只能引用八字命盘');
    return name === undefined ? input : { name, ...input };
  }));
  return { ...args, a: people[0], b: people[1] };
}
