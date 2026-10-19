import { defineDerivedToolContract } from '../../contract.js';
import { deriveAstrologyPoint, type AstrologyPointOutput, type AstrologyPointSelector } from '../../../domains/astrology/point.js';
import { toAstrologyPointJson, toAstrologyPointText } from '../../../domains/astrology/point-render.js';
import type { AstrologyInput, AstrologyOutput } from '../../../domains/astrology/types.js';
import { astrologyManifest } from '../astrology/tool.js';
import { ASTROLOGY_POINT_DESCRIPTION, astrologyPointSelector } from './definition.js';
import { astrologyPointOutputSchema } from './output-schema.js';

export const astrologyPointManifest = defineDerivedToolContract<AstrologyInput, AstrologyOutput, AstrologyPointSelector, AstrologyPointOutput>({
  base: astrologyManifest,
  name: 'astrology_point',
  description: ASTROLOGY_POINT_DESCRIPTION,
  selector: astrologyPointSelector,
  derive: deriveAstrologyPoint,
  renderText: toAstrologyPointText,
  renderJSON: toAstrologyPointJson,
  outputSchema: astrologyPointOutputSchema,
});
