import { defineDerivedToolContract } from '../../contract.js';
import { deriveLiuyaoLine, type LiuyaoLineOutput, type LiuyaoLineSelector } from '../../../domains/liuyao/line.js';
import { toLiuyaoLineJson, toLiuyaoLineText } from '../../../domains/liuyao/line-render.js';
import type { LiuyaoInput, LiuyaoOutput } from '../../../domains/liuyao/types.js';
import { liuyaoManifest } from '../liuyao/tool.js';
import { LIUYAO_LINE_DESCRIPTION, liuyaoLineSelector } from './definition.js';
import { liuyaoLineOutputSchema } from './output-schema.js';

export const liuyaoLineManifest = defineDerivedToolContract<LiuyaoInput, LiuyaoOutput, LiuyaoLineSelector, LiuyaoLineOutput>({
  base: liuyaoManifest,
  name: 'liuyao_line',
  description: LIUYAO_LINE_DESCRIPTION,
  selector: liuyaoLineSelector,
  derive: deriveLiuyaoLine,
  renderText: toLiuyaoLineText,
  renderJSON: toLiuyaoLineJson,
  outputSchema: liuyaoLineOutputSchema,
});
