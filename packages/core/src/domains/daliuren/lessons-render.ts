import { withRulesJSON, withRulesText } from '../../shared/calculation-rules.js';
import { renderFactSections } from '../shared/fact-sections-text.js';
import type { DaliurenLessonsOutput, DaliurenLessonsSections } from './lessons.js';

export type DaliurenLessonsCanonicalJSON = DaliurenLessonsSections & { 口径: string[] };

const DALIUREN_LESSONS_NOTES = [
  '只列四课三传的盘面事实与五行生克，不取用神、不判吉凶与应期',
  '四课上下：下克上为贼、上克下为克，其余写作比和、上生下、下生上；课体与取传沿用排盘结果',
  '神将：神克将为内战、将克神为外战，二者都记作「战」；天将五行按同类相属（《六壬大全》以将之五行论生克）',
  '六亲以日干为我：生我父母、我生子孙、克我官鬼、我克妻财、同我兄弟',
  '旺衰按月建（月支）论十二支五行；空亡取日旬空',
  '日干寄宫取一课上神所临的地盘支；类神可为十二地支或十二天将',
  '本命与行年沿用排盘结果，行年按立春换年、男顺女逆',
];

function renderDaliurenLessonsJSONBase(result: DaliurenLessonsOutput): DaliurenLessonsCanonicalJSON {
  return { ...structuredClone(result.sections), 口径: [...DALIUREN_LESSONS_NOTES] };
}

function renderDaliurenLessonsTextBase(result: DaliurenLessonsOutput): string {
  return renderFactSections('大六壬课传详查', { ...result.sections, 口径: DALIUREN_LESSONS_NOTES });
}

export const toDaliurenLessonsJson = withRulesJSON(renderDaliurenLessonsJSONBase);
export const toDaliurenLessonsText = withRulesText(renderDaliurenLessonsTextBase);
