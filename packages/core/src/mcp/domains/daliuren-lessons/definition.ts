import type { ToolInputSchema } from '../../contract.js';
import { DALIUREN_FOCUS } from '../../../domains/daliuren/lessons.js';

export const DALIUREN_LESSONS_DESCRIPTION = '大六壬课传详查 - 在已起的六壬课上详查四课与三传：逐课列上下神的贼克生克、所乘天将、神将与遁干六亲；逐传列地支五行、与日干关系、旺衰、旬空与递生递克；另给日干寄宫、本命行年的上神，以及类神（地支或天将）的天盘落处与入课入传。用 focus 只看课、只看传或只看类神；给了 leiShen 而不指定 focus 时只列类神。下克上为贼，神克将为内战、将克神为外战；六亲以日干为我。只给事实，不下吉凶结论。';

export const daliurenLessonsSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    focus: {
      type: 'string', enum: [...DALIUREN_FOCUS],
      description: '全部=四课三传与本命行年；课、传只列其一（给了类神时一并列出）；类神=只列类神，须同时给 leiShen。省略时有 leiShen 取类神，否则取全部',
    },
    leiShen: { type: 'string', minLength: 1, maxLength: 4, description: '类神：十二地支之一或十二天将名（如 卯、贵人），列出其天盘落处与入课入传' },
  },
  examples: [
    {},
    { focus: '课' },
    { focus: '传', leiShen: '贵人' },
    { leiShen: '卯' },
  ],
};
