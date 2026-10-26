import type { ToolDefinition } from '../../contract.js';
import { baziRuleInputs } from '../../rule-input-schemas.js';

export const baziCalculateDefinition: ToolDefinition = {
  name: 'bazi',
  description: "八字命盘 - 根据出生信息排四柱命盘，输出四柱干支、十神、藏干、地势、空亡与干支关系，可选输出纳音、神煞等扩展信息。",
  inputSchema: {
    type: 'object',
    properties: {
      ...baziRuleInputs,
      gender: {
        type: 'string',
        enum: ['male', 'female'],
        description: '性别',
      },
      birthYear: {
        type: 'integer', minimum: 1, maximum: 9999,
        description: '出生年 (1-9999；公元纪年)',
      },
      birthMonth: {
        type: 'integer', minimum: 1, maximum: 12,
        description: "出生月（1-12）",
      },
      birthDay: {
        type: 'integer', minimum: 1, maximum: 31,
        description: "出生日（公历 1-31，农历 1-30）",
      },
      birthHour: {
        type: 'integer', minimum: 0, maximum: 23,
        description: "出生时（0-23）；不知道出生时辰时省略，此时不排时柱，也不给命宫、时柱神煞与小运",
      },
      birthMinute: {
        type: 'integer', minimum: 0, maximum: 59,
        description: "出生分（0-59）；省略 birthHour 时不填",
        default: 0,
      },
      calendarType: {
        type: 'string',
        enum: ['solar', 'lunar'],
        description: "出生日期的历法（solar=公历，lunar=农历）",
        default: 'solar',
      },
      isLeapMonth: {
        type: 'boolean',
        description: "是否农历闰月（仅 calendarType=lunar 时有效）",
        default: false,
      },
      birthPlace: {
        type: 'string',
        description: '出生地点文本',
      },
      longitude: {
        type: 'number', minimum: -180, maximum: 180,
        description: "出生地经度（-180 到 180；提供时按真太阳时校正出生时间）",
      },
      detailLevel: {
        type: 'string',
        enum: ['default', 'full'],
        description: "输出详略（default=核心盘面；full=追加纳音、神煞、胎元、命宫等）",
        default: 'default',
      },
    },
    required: ['gender', 'birthYear', 'birthMonth', 'birthDay'],
    examples: [
      { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 },
      { gender: 'female', birthYear: 1995, birthMonth: 6, birthDay: 20, birthHour: 23, calendarType: 'lunar' },
      { gender: 'female', birthYear: 1988, birthMonth: 3, birthDay: 12 },
    ],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
export const baziDefinition = baziCalculateDefinition;
