import { defineDerivedToolContract } from '../../contract.js';
import { deriveDaliurenLessons, type DaliurenLessonsOutput, type DaliurenLessonsSelector } from '../../../domains/daliuren/lessons.js';
import { toDaliurenLessonsJson, toDaliurenLessonsText } from '../../../domains/daliuren/lessons-render.js';
import type { DaliurenInput, DaliurenOutput } from '../../../domains/daliuren/types.js';
import { daliurenManifest } from '../daliuren/tool.js';
import { DALIUREN_LESSONS_DESCRIPTION, daliurenLessonsSelector } from './definition.js';
import { daliurenLessonsOutputSchema } from './output-schema.js';

export const daliurenLessonsManifest = defineDerivedToolContract<DaliurenInput, DaliurenOutput, DaliurenLessonsSelector, DaliurenLessonsOutput>({
  base: daliurenManifest,
  name: 'daliuren_lessons',
  description: DALIUREN_LESSONS_DESCRIPTION,
  selector: daliurenLessonsSelector,
  derive: deriveDaliurenLessons,
  renderText: toDaliurenLessonsText,
  renderJSON: toDaliurenLessonsJson,
  outputSchema: daliurenLessonsOutputSchema,
});
