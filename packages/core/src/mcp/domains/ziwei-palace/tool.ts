import { defineDerivedToolContract } from '../../contract.js';
import { deriveZiweiPalace, type ZiweiPalaceOutput, type ZiweiPalaceSelector } from '../../../domains/ziwei/palace.js';
import { toZiweiPalaceJson, toZiweiPalaceText } from '../../../domains/ziwei/palace-render.js';
import type { ZiweiInput, ZiweiOutput } from '../../../domains/ziwei/types.js';
import { ziweiManifest } from '../ziwei/tool.js';
import { ZIWEI_PALACE_DESCRIPTION, ziweiPalaceSelector } from './definition.js';
import { ziweiPalaceOutputSchema } from './output-schema.js';

export const ziweiPalaceManifest = defineDerivedToolContract<ZiweiInput, ZiweiOutput, ZiweiPalaceSelector, ZiweiPalaceOutput>({
  base: ziweiManifest,
  name: 'ziwei_palace',
  description: ZIWEI_PALACE_DESCRIPTION,
  selector: ziweiPalaceSelector,
  derive: deriveZiweiPalace,
  renderText: toZiweiPalaceText,
  renderJSON: toZiweiPalaceJson,
  outputSchema: ziweiPalaceOutputSchema,
});
