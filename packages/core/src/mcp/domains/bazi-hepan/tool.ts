import { calculateBaziHepan, type BaziHepanInput, type BaziHepanOutput } from '../../../domains/bazi/hepan.js';
import { toBaziHepanJson, toBaziHepanText } from '../../../domains/bazi/hepan-render.js';
import { defineToolContract } from '../../contract.js';
import { baziHepanDefinition } from './definition.js';
import { baziHepanOutputSchema } from './output-schema.js';

export const baziHepanManifest = defineToolContract<BaziHepanInput, BaziHepanOutput>({
  definition: baziHepanDefinition,
  execute: calculateBaziHepan,
  renderText: toBaziHepanText,
  renderJSON: toBaziHepanJson,
  outputSchema: baziHepanOutputSchema,
});
