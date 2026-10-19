import type { ToolInputSchema } from '../../contract.js';

export const DALIUREN_LESSONS_DESCRIPTION = '大六壬课传详查 - 在已起的六壬课上详查四课与三传：逐课列上下神的贼克生克、所乘天将、神将与遁干六亲；逐传列地支五行、与日干关系、旺衰、旬空与递生递克；另给日干寄宫、本命行年的上神，以及类神（地支或天将）的天盘落处与入课入传。只给事实，不下吉凶结论。';

export const daliurenLessonsSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    focus: { type: 'string', enum: ['全部', '课', '传'], default: '全部', description: '只列四课、只列三传，或两者都列' },
    leiShen: { type: 'string', minLength: 1, maxLength: 4, description: '类神：十二地支之一或十二天将名（如 卯、贵人），列出其天盘落处与入课入传' },
  },
  examples: [
    {},
    { focus: '课' },
    { focus: '传', leiShen: '贵人' },
  ],
};
