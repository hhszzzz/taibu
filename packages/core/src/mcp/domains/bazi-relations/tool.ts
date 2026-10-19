import { defineDerivedToolContract } from '../../contract.js';
import { deriveBaziRelations, type BaziRelationsOutput, type BaziRelationsSelector } from '../../../domains/bazi/relations.js';
import { toBaziRelationsJson, toBaziRelationsText } from '../../../domains/bazi/relations-render.js';
import type { BaziInput, BaziOutput } from '../../../domains/bazi/types.js';
import { baziManifest } from '../bazi/tool.js';
import { BAZI_RELATIONS_DESCRIPTION, baziRelationsSelector } from './definition.js';
import { baziRelationsOutputSchema } from './output-schema.js';

export const baziRelationsManifest = defineDerivedToolContract<BaziInput, BaziOutput, BaziRelationsSelector, BaziRelationsOutput>({
  base: baziManifest,
  name: 'bazi_relations',
  description: BAZI_RELATIONS_DESCRIPTION,
  selector: baziRelationsSelector,
  derive: deriveBaziRelations,
  renderText: toBaziRelationsText,
  renderJSON: toBaziRelationsJson,
  outputSchema: baziRelationsOutputSchema,
});
