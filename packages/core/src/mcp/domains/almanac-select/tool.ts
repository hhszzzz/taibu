import { calculateAlmanacSelection } from '../../../domains/almanac/select.js';
import { toAlmanacSelectJson, toAlmanacSelectText } from '../../../domains/almanac/select-render.js';
import { defineToolContract } from '../../contract.js';
import { almanacSelectDefinition } from './definition.js';
import { almanacSelectOutputSchema } from './output-schema.js';
import type { AlmanacSelectInput, AlmanacSelectOutput } from '../../../domains/almanac/select-types.js';

export const almanacSelectManifest = defineToolContract<AlmanacSelectInput, AlmanacSelectOutput>({
  definition: almanacSelectDefinition,
  execute: calculateAlmanacSelection,
  renderText: toAlmanacSelectText,
  renderJSON: toAlmanacSelectJson,
  outputSchema: almanacSelectOutputSchema,
});
