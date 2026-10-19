import { defineDerivedToolContract } from '../../contract.js';
import { deriveQimenPalace, type QimenPalaceOutput, type QimenPalaceSelector } from '../../../domains/qimen/palace.js';
import { toQimenPalaceJson, toQimenPalaceText } from '../../../domains/qimen/palace-render.js';
import type { QimenInput, QimenOutput } from '../../../domains/qimen/types.js';
import { qimenManifest } from '../qimen/tool.js';
import { QIMEN_PALACE_DESCRIPTION, qimenPalaceSelector } from './definition.js';
import { qimenPalaceOutputSchema } from './output-schema.js';

export const qimenPalaceManifest = defineDerivedToolContract<QimenInput, QimenOutput, QimenPalaceSelector, QimenPalaceOutput>({
  base: qimenManifest,
  name: 'qimen_palace',
  description: QIMEN_PALACE_DESCRIPTION,
  selector: qimenPalaceSelector,
  derive: deriveQimenPalace,
  renderText: toQimenPalaceText,
  renderJSON: toQimenPalaceJson,
  outputSchema: qimenPalaceOutputSchema,
});
