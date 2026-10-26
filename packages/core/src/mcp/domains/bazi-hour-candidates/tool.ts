import { calculateBaziHourCandidates, type BaziHourCandidatesInput, type BaziHourCandidatesOutput } from '../../../domains/bazi/hour-candidates.js';
import { toBaziHourCandidatesJson, toBaziHourCandidatesText } from '../../../domains/bazi/hour-candidates-render.js';
import { defineToolContract } from '../../contract.js';
import { baziHourCandidatesDefinition } from './definition.js';
import { baziHourCandidatesOutputSchema } from './output-schema.js';

export const baziHourCandidatesManifest = defineToolContract<BaziHourCandidatesInput, BaziHourCandidatesOutput>({
  definition: baziHourCandidatesDefinition,
  execute: calculateBaziHourCandidates,
  renderText: toBaziHourCandidatesText,
  renderJSON: toBaziHourCandidatesJson,
  outputSchema: baziHourCandidatesOutputSchema,
});
