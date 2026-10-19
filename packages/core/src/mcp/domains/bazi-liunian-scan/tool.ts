import { defineDerivedToolContract } from '../../contract.js';
import { deriveBaziLiunianScan, type BaziLiunianScanOutput, type BaziLiunianScanSelector } from '../../../domains/bazi/liunian-scan.js';
import { toBaziLiunianScanJson, toBaziLiunianScanText } from '../../../domains/bazi/liunian-scan-render.js';
import type { BaziInput, BaziOutput } from '../../../domains/bazi/types.js';
import { baziManifest } from '../bazi/tool.js';
import { BAZI_LIUNIAN_SCAN_DESCRIPTION, baziLiunianScanSelector } from './definition.js';
import { baziLiunianScanOutputSchema } from './output-schema.js';

export const baziLiunianScanManifest = defineDerivedToolContract<BaziInput, BaziOutput, BaziLiunianScanSelector, BaziLiunianScanOutput>({
  base: baziManifest,
  name: 'bazi_liunian_scan',
  description: BAZI_LIUNIAN_SCAN_DESCRIPTION,
  selector: baziLiunianScanSelector,
  derive: deriveBaziLiunianScan,
  renderText: toBaziLiunianScanText,
  renderJSON: toBaziLiunianScanJson,
  outputSchema: baziLiunianScanOutputSchema,
});
