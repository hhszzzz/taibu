import { defineDerivedToolContract } from '../../contract.js';
import { deriveBaziWuxing, type BaziWuxingOutput, type BaziWuxingSelector } from '../../../domains/bazi/wuxing.js';
import { toBaziWuxingJson, toBaziWuxingText } from '../../../domains/bazi/wuxing-render.js';
import type { BaziInput, BaziOutput } from '../../../domains/bazi/types.js';
import { baziManifest } from '../bazi/tool.js';
import { BAZI_WUXING_DESCRIPTION, baziWuxingSelector } from './definition.js';
import { baziWuxingOutputSchema } from './output-schema.js';

export const baziWuxingManifest = defineDerivedToolContract<BaziInput, BaziOutput, BaziWuxingSelector, BaziWuxingOutput>({
  base: baziManifest,
  name: 'bazi_wuxing',
  description: BAZI_WUXING_DESCRIPTION,
  selector: baziWuxingSelector,
  derive: (chart, selector) => deriveBaziWuxing(chart, selector),
  renderText: toBaziWuxingText,
  renderJSON: toBaziWuxingJson,
  outputSchema: baziWuxingOutputSchema,
});
