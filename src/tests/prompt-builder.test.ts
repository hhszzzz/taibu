import { test } from 'node:test';
import assert from 'node:assert/strict';

const buildMinimalBaziChart = () => ({
    name: '张三',
    gender: 'male',
    birthDate: '1990-01-01',
    birthTime: '08:00',
    birthPlace: '北京',
    timezone: 8,
    calendarType: 'solar',
    fourPillars: {
        year: { stem: '甲', branch: '子', stemElement: '木', branchElement: '水', hiddenStems: ['癸'] },
        month: { stem: '乙', branch: '丑', stemElement: '木', branchElement: '土', hiddenStems: ['癸', '辛', '己'] },
        day: { stem: '甲', branch: '子', stemElement: '木', branchElement: '水', hiddenStems: ['癸'] },
        hour: { stem: '丙', branch: '寅', stemElement: '火', branchElement: '木', hiddenStems: ['甲', '丙', '戊'] },
    },
    dayMaster: '甲',
    fiveElements: { 金: 1, 木: 2, 水: 2, 火: 1, 土: 0 },
});

const buildOversizedCaseProfile = () => ({
    masterReview: {
        strengthLevel: '偏强',
        patterns: ['财格'],
        yongShen: { basic: ['水'], advanced: ['壬'] },
        xiShen: { basic: ['金'], advanced: ['申金'] },
        jiShen: { basic: ['火'], advanced: [] },
        xianShen: { basic: ['土'], advanced: [] },
        summary: '甲'.repeat(300),
    },
    ownerFeedback: {
        occupation: '上班族',
        education: '本科',
        wealthLevel: '小康',
        marriageStatus: '已婚',
        healthStatus: '健康稳定',
        familyStatusTags: ['父母助力'],
        temperamentTags: ['务实'],
        summary: '乙'.repeat(300),
    },
    events: Array.from({ length: 10 }, (_, index) => ({
        id: `event-${index + 1}`,
        eventDate: `2025-01-${String(index + 1).padStart(2, '0')}`,
        category: '事业',
        title: `事件${index + 1}`,
        detail: '丙'.repeat(500),
    })),
});

test('buildPromptWithSources includes base rules and dify prefix', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '测试问题',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
        difyContext: { webContent: '网页内容', fileContent: '文件内容' }
    });

    assert.ok(res.systemPrompt.includes('数据使用规则'));
    assert.ok(res.diagnostics.some((layer: { id: string; included: boolean }) => layer.id === 'base_rules' && layer.included));
    assert.ok(res.userMessagePrefix.includes('【用户上传的文件内容如下】'));
    assert.ok(res.userMessagePrefix.includes('【网络搜索结果如下】'));
    assert.ok(!res.systemPrompt.includes('【用户上传的文件内容如下】'));
});

test('buildPromptWithSources injects identity as semantic text instead of raw json', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '请结合我的身份来回答',
        mentions: [],
        knowledgeHits: [],
        userSettings: {
            expressionStyle: 'direct',
            userProfile: { identity: '创业者' },
            customInstructions: '',
        },
    });

    assert.ok(res.systemPrompt.includes('用户身份：创业者'));
    assert.ok(!res.systemPrompt.includes('"identity"'));
});

test('buildPromptWithSources injects dream and mangpai layers', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '测试问题',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
        dreamMode: { enabled: true, baziText: '命盘文本', fortuneText: '运势文本' },
        chartContext: { baziChart: buildMinimalBaziChart(), analysisMode: 'mangpai' }
    });

    assert.ok(res.systemPrompt.includes('解梦'));
    assert.ok(res.systemPrompt.includes('【命盘信息】'));
    assert.ok(res.systemPrompt.includes('【今日运势】'));
    assert.ok(res.systemPrompt.includes('盲派'));
    assert.ok(res.systemPrompt.includes('【盲派口诀】'));
    assert.ok(res.diagnostics.some((layer: { id: string; included: boolean }) => layer.id.startsWith('personality_role') && layer.included));
    assert.ok(res.diagnostics.some((layer: { id: string; included: boolean }) => layer.id === 'mangpai_data' && layer.included));
});

test('buildPromptWithSources appends structured bazi case profile context', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '结合这个命盘继续分析',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
        chartContext: {
            baziChart: {
                ...buildMinimalBaziChart(),
                caseProfile: {
                    masterReview: {
                        strengthLevel: '偏强',
                        patterns: ['财格'],
                        yongShen: { basic: ['水'], advanced: ['壬'] },
                        xiShen: { basic: ['金'], advanced: ['申金'] },
                        jiShen: { basic: ['火'], advanced: [] },
                        xianShen: { basic: ['土'], advanced: [] },
                        summary: '财星可用，先取水润局。',
                    },
                    ownerFeedback: {
                        occupation: '上班族',
                        education: '本科',
                        wealthLevel: '小康',
                        marriageStatus: '已婚',
                        healthStatus: '健康稳定',
                        familyStatusTags: ['父母助力'],
                        temperamentTags: ['务实'],
                        summary: '近年事业稳定上升。',
                    },
                    events: [
                        {
                            id: 'event-1',
                            eventDate: '2025-01-01',
                            category: '事业',
                            title: '岗位晋升',
                            detail: '2025 年初完成晋升。',
                        },
                    ],
                },
            },
        },
    });

    assert.ok(res.systemPrompt.includes('【断事笔记】'));
    assert.ok(res.systemPrompt.includes('旺衰：偏强'));
    assert.ok(res.systemPrompt.includes('用神：基础=水；进阶=壬'));
    assert.ok(res.systemPrompt.includes('命主反馈'));
    assert.ok(res.systemPrompt.includes('关键事件'));
});

test('buildPromptWithSources should enrich minimal bazi chart data before rendering canonical text', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const baziModule = require('../lib/divination/bazi') as typeof import('../lib/divination/bazi');
    const rebuiltBundle = baziModule.calculateBaziChartBundle({
        name: 'hhs',
        gender: 'male',
        birthYear: 2002,
        birthMonth: 9,
        birthDay: 9,
        birthHour: 11,
        birthMinute: 0,
        birthPlace: '广东省广州市',
        calendarType: 'solar',
        isLeapMonth: false,
    });
    const rebuiltText = baziModule.generateBaziChartText(rebuiltBundle.output, {
        name: 'hhs',
        meta: rebuiltBundle.meta,
    });
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '结合命盘分析',
        mentions: [
            {
                type: 'bazi_chart',
                id: 'bazi-minimal-1',
                name: '最小命盘',
                preview: '命盘',
                resolvedContent: '',
            },
        ],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
        chartContext: {
            baziChart: {
                name: 'hhs',
                gender: 'male',
                birthDate: '2002-09-09',
                birthTime: '11:00',
                birthPlace: '广东省广州市',
                timezone: 8,
                calendarType: 'solar',
                fourPillars: {
                    year: { stem: '癸', branch: '未', stemElement: '水', branchElement: '土', hiddenStems: ['己', '丁', '乙'] },
                    month: { stem: '庚', branch: '申', stemElement: '金', branchElement: '金', hiddenStems: ['庚', '壬', '戊'] },
                    day: { stem: '戊', branch: '寅', stemElement: '土', branchElement: '木', hiddenStems: ['甲', '丙', '戊'] },
                    hour: { stem: '丁', branch: '巳', stemElement: '火', branchElement: '火', hiddenStems: ['丙', '庚', '戊'] },
                },
                dayMaster: '戊',
                fiveElements: { 金: 1, 木: 1, 水: 1, 火: 2, 土: 3 },
            },
        },
    });

    const rebuiltExcerpt = rebuiltText.split('\n').slice(0, 18).join('\n');
    assert.ok(res.systemPrompt.includes(rebuiltExcerpt));
    assert.ok(!res.systemPrompt.includes('己(-)、丁(-)、乙(-)'));
    assert.ok(!res.systemPrompt.includes('庚(-)、壬(-)、戊(-)'));
});

test('buildPromptWithSources should honor chartPromptDetailLevel for selected bazi chart injection', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const chart = buildMinimalBaziChart();

    const defaultRes = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '结合命盘分析',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', chartPromptDetailLevel: 'default', userProfile: {}, customInstructions: '' },
        chartContext: { baziChart: chart },
    });

    const fullRes = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '结合命盘分析',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', chartPromptDetailLevel: 'full', userProfile: {}, customInstructions: '' },
        chartContext: { baziChart: chart },
    });

    assert.ok(!defaultRes.systemPrompt.includes('命主五行'));
    assert.ok(fullRes.systemPrompt.includes('命主五行'));
});

test('buildPromptWithSources skips P2 layers when budget exceeded', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const hugeContent = 'a'.repeat(20000);
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '测试问题',
        mentions: [{ type: 'ming_record', id: 'r1', name: '记录1', preview: 'p', resolvedContent: hugeContent }],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' }
    });

    const mentionLayer = res.diagnostics.find((layer: { id: string }) => layer.id === 'mention_r1');
    assert.ok(mentionLayer);
    assert.equal(mentionLayer.included, false);
    assert.ok(!res.systemPrompt.includes(hugeContent.slice(0, 200)));
});

test('buildPromptWithSources should include visualization preference instructions when configured', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '请分析我的运势',
        mentions: [],
        knowledgeHits: [],
        userSettings: {
            expressionStyle: 'direct',
            userProfile: {},
            customInstructions: '',
            visualizationSettings: {
                selectedDimensions: ['career', 'wealth'],
                dayunDisplayCount: 6,
                chartStyle: 'classic-chinese',
            },
        },
    });

    assert.ok(res.systemPrompt.includes('事业/学业'));
    assert.ok(res.systemPrompt.includes('财富'));
    assert.ok(res.systemPrompt.includes('6 个大运周期'));
    assert.ok(res.systemPrompt.includes('古典中文图表风格'));
    assert.ok(res.diagnostics.some((layer: { id: string; included: boolean }) => layer.id === 'visualization_dimensions' && layer.included));
    assert.ok(res.diagnostics.some((layer: { id: string; included: boolean }) => layer.id === 'visualization_dayun_display' && layer.included));
    assert.ok(res.diagnostics.some((layer: { id: string; included: boolean }) => layer.id === 'visualization_chart_style' && layer.included));
});

test('buildPromptWithSources injects chart contract for mention-driven analysis', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '请结合这条塔罗记录给我可视化分析',
        mentions: [
            {
                type: 'tarot_reading',
                id: 'tarot-1',
                name: '塔罗记录',
                preview: '三张牌解读',
                resolvedContent: '抽牌结果：愚者、恋人、力量',
            },
        ],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
    });

    assert.ok(res.systemPrompt.includes('```chart'));
    assert.ok(res.systemPrompt.includes('chartType、title、data'));
    // Dynamic chart type: tarot mention → tarot_elements hint
    assert.ok(res.systemPrompt.includes('tarot_elements'));
    assert.ok(
        res.diagnostics.some(
            (layer: { id: string; included: boolean }) => layer.id === 'visualization_output_contract' && layer.included,
        ),
    );
});

test('buildPromptWithSources includes relevant chart types based on bazi chart context', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '请分析我的大运',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
        chartContext: { baziChart: buildMinimalBaziChart() },
    });

    // Bazi chart context → life_fortune_trend, fortune_radar, wuxing_energy hints
    assert.ok(res.systemPrompt.includes('life_fortune_trend'));
    assert.ok(res.systemPrompt.includes('fortune_radar'));
    assert.ok(res.systemPrompt.includes('wuxing_energy'));
});

test('buildPromptWithSources should enrich ziwei chart data from base birth info before rendering canonical text', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const ziweiModule = require('../lib/divination/ziwei') as typeof import('../lib/divination/ziwei');
    const rebuiltChart = ziweiModule.calculateZiweiChartBundle({
        name: '紫微命主',
        gender: 'male',
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        birthHour: 8,
        birthMinute: 0,
        calendarType: 'solar',
        isLeapMonth: false,
        birthPlace: '北京',
        longitude: 116.4074,
    }).output;
    const rebuiltText = ziweiModule.generateZiweiChartText(rebuiltChart);
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '结合紫微命盘分析',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
        chartContext: {
            ziweiChart: {
                name: '紫微命主',
                gender: 'male',
                birthDate: '1990-01-01',
                birthTime: '08:00',
                birthPlace: '北京',
                longitude: 116.4074,
                calendarType: 'solar',
                isLeapMonth: false,
            },
        },
    });

    assert.ok(res.systemPrompt.includes(rebuiltText.split('\n').slice(0, 20).join('\n')));
});

test('buildPromptWithSources does not token-truncate selected chart context when chart block exceeds budget', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '请结合我选中的命盘继续分析事业',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
        chartContext: {
            baziChart: {
                ...buildMinimalBaziChart(),
                caseProfile: buildOversizedCaseProfile(),
            },
        },
    });

    const chartLayer = res.diagnostics.find((layer: { id: string }) => layer.id === 'chart_context');
    assert.ok(chartLayer);
    assert.equal(chartLayer.included, false);
    assert.equal(chartLayer.truncated, false);
    assert.equal(chartLayer.reason, 'budget_exceeded');
    assert.ok(!res.systemPrompt.includes('用户已选择以下命盘作为对话参考'));
    assert.ok(!res.systemPrompt.includes('# 八字命盘'));
});

test('buildPromptWithSources includes dream_association for dream mode', async () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const res = await pb.buildPromptWithSources({
        modelId: 'deepseek-chat',
        userMessage: '我梦到了飞翔',
        mentions: [],
        knowledgeHits: [],
        userSettings: { expressionStyle: 'direct', userProfile: {}, customInstructions: '' },
        dreamMode: { enabled: true, baziText: '命盘文本', fortuneText: '运势文本' },
    });

    assert.ok(res.systemPrompt.includes('dream_association'));
});

test('resolvePersonalities selects dream and mangpai correctly', () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const dreamOnly = pb.resolvePersonalities({ dreamMode: { enabled: true } });
    assert.deepEqual(dreamOnly, { personalities: ['dream'], isMultiple: false });

    const mangpai = pb.resolvePersonalities({
        chartContext: { baziChart: buildMinimalBaziChart(), analysisMode: 'mangpai' }
    });
    assert.deepEqual(mangpai, { personalities: ['mangpai'], isMultiple: false });
});

test('resolvePersonalities selects bazi/ziwei/general correctly', () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const baziZiwei = pb.resolvePersonalities({
        chartContext: { baziChart: buildMinimalBaziChart(), ziweiChart: { palaces: {} } }
    });
    assert.deepEqual(baziZiwei, { personalities: ['bazi', 'ziwei'], isMultiple: true });

    const ziweiOnly = pb.resolvePersonalities({
        chartContext: { ziweiChart: { palaces: {} } }
    });
    assert.deepEqual(ziweiOnly, { personalities: ['ziwei'], isMultiple: false });

    const none = pb.resolvePersonalities({});
    assert.deepEqual(none, { personalities: ['general'], isMultiple: false });
});

test('resolvePersonalities considers mentions for bazi/ziwei', () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const baziMention = pb.resolvePersonalities({
        mentions: [{ type: 'bazi_chart', id: 'b1', name: '八字', preview: 'p' }]
    });
    assert.deepEqual(baziMention, { personalities: ['bazi'], isMultiple: false });

    const bothMentions = pb.resolvePersonalities({
        mentions: [
            { type: 'bazi_chart', id: 'b1', name: '八字', preview: 'p' },
            { type: 'ziwei_chart', id: 'z1', name: '紫微', preview: 'p' }
        ]
    });
    assert.deepEqual(bothMentions, { personalities: ['bazi', 'ziwei'], isMultiple: true });
});

test('buildPersonalityPrompt composes single and multi roles', () => {
    const pb = require('../lib/ai/prompt-builder') as any;
    const single = pb.buildPersonalityPrompt(['dream']);
    assert.ok(single.includes('解梦'));
    assert.ok(!single.includes('你同时具备以下专业能力'));

    const multi = pb.buildPersonalityPrompt(['bazi', 'ziwei']);
    assert.ok(multi.includes('【八字宗师】'));
    assert.ok(multi.includes('【紫微斗数】'));
    // 多人格直接拼接，不再包装额外指令
    assert.ok(!multi.includes('你同时具备以下专业能力'));
});

test('countTokens estimates Chinese heavier than Latin', () => {
    const utils = require('../lib/token-utils') as any;
    const cn = '你'.repeat(60);
    const en = 'a'.repeat(60);
    assert.ok(utils.countTokens(cn) > utils.countTokens(en));
});

test('truncateToTokens reduces token count', () => {
    const utils = require('../lib/token-utils') as any;
    const text = 'A'.repeat(4000);
    const before = utils.countTokens(text);
    const truncated = utils.truncateToTokens(text, 200);
    const after = utils.countTokens(truncated);
    assert.ok(before > 200);
    assert.ok(after <= 260);
});

test('SourceTracker does not inject empty content', () => {
    const st = require('../lib/source-tracker') as any;
    const tracker = st.createSourceTracker();
    const result = tracker.trackAndInject({ type: 'mention', id: 'x', name: 'X', content: '   ' });
    assert.equal(result.injected, false);
    assert.deepEqual(tracker.getSources(), []);
});

test('SourceTracker truncates when maxTokens is set', () => {
    const st = require('../lib/source-tracker') as any;
    const tracker = st.createSourceTracker();
    const content = '内容'.repeat(500);
    const result = tracker.trackAndInject({ type: 'mention', id: 'm1', name: 'M1', content, maxTokens: 10 });
    assert.equal(result.injected, true);
    const sources = tracker.getSources();
    assert.equal(sources.length, 1);
    assert.equal(sources[0].truncated, true);
    assert.ok(result.content.includes('内容已截断'));
});

test('SourceTracker de-duplicates sources by type and id', () => {
    const st = require('../lib/source-tracker') as any;
    const tracker = st.createSourceTracker();
    tracker.trackAndInject({ type: 'knowledge_base', id: 'kb1', name: 'KB', content: '第一次' });
    tracker.trackAndInject({ type: 'knowledge_base', id: 'kb1', name: 'KB', content: '第二次更新' });
    const sources = tracker.getSources();
    assert.equal(sources.length, 1);
    assert.ok(sources[0].preview.includes('第二次更新'));
});

test('prepared budget and personality preserve standalone output with one model budget lookup', async t => {
    const models = require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
    const lookup = t.mock.method(models, 'getModelConfigAsync', async () => undefined);
    const pb = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
    const context: import('../lib/ai/prompt-builder').PromptContext = {
        modelId: 'offline-model', userMessage: 'question', mentions: [], knowledgeHits: [], userSettings: {},
    };
    const standalone = await pb.buildPromptWithSources(context);
    assert.equal(lookup.mock.callCount(), 1);
    const budget = await pb.calculatePromptBudget(context.modelId);
    const prepared = await pb.buildPromptWithSources(context, { budget, personalityResolution: pb.resolvePersonalities(context) });
    assert.equal(lookup.mock.callCount(), 2);
    assert.deepEqual(prepared, standalone);
});
