import test from 'node:test';
import assert from 'node:assert/strict';


test('extractChartBlocks should parse valid chart blocks from markdown', async () => {
    const { extractChartBlocks } = await import('../lib/visualization/chart-data-extract');

    const markdown = `这是分析文本...

\`\`\`chart
{
  "chartType": "fortune_radar",
  "title": "当前运势评分",
  "data": { "period": "2026年", "scores": {}, "overallScore": 75, "overallLabel": "良好" }
}
\`\`\`

继续分析...

\`\`\`chart
{
  "chartType": "life_fortune_trend",
  "title": "大运趋势",
  "data": { "currentAge": 35, "currentYear": 2026, "periods": [] }
}
\`\`\`
`;

    const results = extractChartBlocks(markdown);
    assert.equal(results.length, 2);
    assert.equal(results[0].chartType, 'fortune_radar');
    assert.equal(results[0].title, '当前运势评分');
    assert.equal(results[1].chartType, 'life_fortune_trend');
    assert.equal(results[1].title, '大运趋势');
});

test('extractChartBlocks should skip malformed JSON blocks', async () => {
    const { extractChartBlocks } = await import('../lib/visualization/chart-data-extract');

    const markdown = `\`\`\`chart
{ invalid json }
\`\`\`

\`\`\`chart
{ "chartType": "fortune_radar", "title": "有效图表", "data": {} }
\`\`\``;

    const results = extractChartBlocks(markdown);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, '有效图表');
});

test('extractChartsFromMessages should deduplicate by chartType + title', async () => {
    const { extractChartsFromMessages } = await import('../lib/visualization/chart-data-extract');

    const messages = [
        {
            role: 'assistant',
            content: '```chart\n{"chartType":"fortune_radar","title":"运势","data":{"v":1}}\n```',
        },
        {
            role: 'user',
            content: '再分析一下',
        },
        {
            role: 'assistant',
            content: '```chart\n{"chartType":"fortune_radar","title":"运势","data":{"v":2}}\n```',
        },
    ];

    const results = extractChartsFromMessages(messages);
    assert.equal(results.length, 1);
    // Should keep the latest version
    assert.equal((results[0].raw as any).data.v, 2);
    assert.deepEqual((results[0].raw as any).data.scores, {});
});

test('formatPreviousChartsForPrompt should produce non-empty text for non-empty input', async () => {
    const { formatPreviousChartsForPrompt } = await import('../lib/visualization/chart-data-extract');

    const charts = [
        { chartType: 'fortune_radar' as const, title: '运势评分', raw: {} as any },
        { chartType: 'life_fortune_trend' as const, title: '大运趋势', raw: {} as any },
    ];

    const text = formatPreviousChartsForPrompt(charts);
    assert.ok(text.includes('运势评分'));
    assert.ok(text.includes('大运趋势'));
    assert.ok(text.includes('fortune_radar'));
});

test('formatPreviousChartsForPrompt should return empty string for empty input', async () => {
    const { formatPreviousChartsForPrompt } = await import('../lib/visualization/chart-data-extract');
    assert.equal(formatPreviousChartsForPrompt([]), '');
});

test('normalizeChartData should sanitize malformed life fortune trend payloads', async () => {
    const { normalizeChartData } = await import('../lib/visualization/chart-data-extract');

    const normalized = normalizeChartData({
        chartType: 'life_fortune_trend',
        title: '大运趋势',
        data: {
            currentAge: '35岁',
            currentYear: '2026年',
            periods: [
                {
                    label: '',
                    startAge: '30',
                    endAge: '39岁',
                    startYear: '2021',
                    endYear: '2030',
                    scores: {
                        事业学业: '81.6',
                        未知维度: 99,
                    },
                    summary: '机会增长',
                    highlights: '贵人出现',
                    warnings: [null, '慎投机'],
                    yearlyScores: [
                        { age: '30岁', year: '2021年', overall: '88.4' },
                        { age: 'bad', year: 2022, overall: 50 },
                    ],
                },
                {
                    label: '无效周期',
                    startAge: null,
                    endAge: null,
                    scores: {
                        未知维度: 90,
                    },
                    yearlyScores: [{ age: 'bad', year: 'bad', overall: 'bad' }],
                },
            ],
            lifeHighlight: {
                bestPeriod: { label: '黄金期', ages: '30-39', reason: '势能强' },
                currentStatus: '稳中向上',
                nextTurningPoint: { age: '41岁', direction: 'sideways', reason: '调整中' },
            },
        },
    } as any) as any;

    assert.equal(normalized.data.currentAge, 35);
    assert.equal(normalized.data.currentYear, 2026);
    assert.equal(normalized.data.periods.length, 1);
    assert.equal(normalized.data.periods[0].label, '阶段1');
    assert.deepEqual(normalized.data.periods[0].scores, { career: 82 });
    assert.deepEqual(normalized.data.periods[0].highlights, ['贵人出现']);
    assert.deepEqual(normalized.data.periods[0].warnings, ['慎投机']);
    assert.deepEqual(normalized.data.periods[0].yearlyScores, [{ age: 30, year: 2021, overall: 88 }]);
    assert.equal(normalized.data.lifeHighlight.nextTurningPoint.age, 41);
    assert.equal(normalized.data.lifeHighlight.nextTurningPoint.direction, 'up');
});

test('normalizeChartData should coerce and filter malformed radar scores', async () => {
    const { normalizeChartData } = await import('../lib/visualization/chart-data-extract');

    const normalized = normalizeChartData({
        chartType: 'fortune_radar',
        title: '当前运势',
        data: {
            period: '2026',
            scores: {
                事业学业: '79.6',
                财富: { score: '65.2', label: '财运', trend: 'down' },
                野生字段: { score: 91, label: '未知', trend: 'up' },
            },
            previousScores: {
                事业学业: '70',
                野生字段: 50,
            },
            overallScore: 'bad',
            overallLabel: '良好',
            topAdvice: '稳健推进',
        },
    } as any) as any;

    assert.deepEqual(normalized.data.scores, {
        career: { score: 80, label: '事业/学业', trend: 'stable' },
        wealth: { score: 65, label: '财运', trend: 'down' },
    });
    assert.deepEqual(normalized.data.previousScores, { career: 70 });
    assert.equal(normalized.data.overallScore, 73);
});

test('extractVisualBlocks reads the first-line title comment and keeps the HTML', async () => {
    const { extractVisualBlocks, VISUAL_BLOCK_MAX_BYTES } = await import('../lib/visualization/chart-data-extract');

    const html = '<div id="root">甲</div>\n<script>document.getElementById("root").textContent = "乙"</script>';
    const markdown = `说明文字

\`\`\`visual
<!-- 交互式时间轴 -->
${html}
\`\`\`

\`\`\`chart
{"chartType":"fortune_radar","title":"运势","data":{}}
\`\`\``;

    const blocks = extractVisualBlocks(markdown);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].title, '交互式时间轴');
    assert.equal(blocks[0].html, html);
    assert.equal(blocks[0].complete, true);
    assert.equal(blocks[0].tooLarge, false);
    assert.equal(blocks[0].bytes, new TextEncoder().encode(html).length);
    assert.ok(blocks[0].bytes <= VISUAL_BLOCK_MAX_BYTES);
});

test('extractVisualBlocks accepts a block without a title comment', async () => {
    const { extractVisualBlocks } = await import('../lib/visualization/chart-data-extract');
    const [block] = extractVisualBlocks('```visual\n<svg></svg>\n```');
    assert.equal(block.title, '');
    assert.equal(block.html, '<svg></svg>');
});

test('extractVisualBlocks flags a block over 64 KB instead of rendering it', async () => {
    const { extractVisualBlocks, VISUAL_BLOCK_MAX_BYTES } = await import('../lib/visualization/chart-data-extract');
    const html = `<p>${'甲'.repeat(22000)}</p>`;
    const [block] = extractVisualBlocks(`\`\`\`visual\n${html}\n\`\`\``);
    assert.ok(block.bytes > VISUAL_BLOCK_MAX_BYTES);
    assert.equal(block.tooLarge, true);
});

test('extractVisualBlocks treats an unclosed fence as incomplete', async () => {
    const { extractVisualBlocks } = await import('../lib/visualization/chart-data-extract');
    const blocks = extractVisualBlocks('前文\n\n```visual\n<!-- 未完成 -->\n<div>一半</div>\n');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].complete, false);
    assert.equal(blocks[0].title, '未完成');
    assert.equal(blocks[0].html, '<div>一半</div>');
});

test('parseChartSource returns null for malformed JSON and normalizes valid data', async () => {
    const { parseChartSource } = await import('../lib/visualization/chart-data-extract');
    assert.equal(parseChartSource('{ invalid }'), null);
    assert.equal(parseChartSource(''), null);
    const chart = parseChartSource('{"chartType":"fortune_radar","title":"运势","data":{"scores":{"事业学业":"79.6"},"overallScore":"bad"}}');
    assert.equal(chart?.chartType, 'fortune_radar');
    assert.deepEqual((chart as any).data.scores.career.score, 80);
    assert.equal((chart as any).data.overallScore, 80);
});

test('parseChartSource keeps a legacy chart block that has no title', async () => {
    const { parseChartSource } = await import('../lib/visualization/chart-data-extract');
    const chart = parseChartSource('{"chartType":"fortune_radar","data":{}}');
    assert.equal(chart?.chartType, 'fortune_radar');
    assert.equal(chart?.title, '');
});

test('normalizeChartData accepts wuxing elements written as [{name,value}]', async () => {
    const { normalizeChartData } = await import('../lib/visualization/chart-data-extract');
    const normalized = normalizeChartData({
        chartType: 'wuxing_energy',
        title: '五行',
        data: {
            elements: [
                { name: '木', value: 40 },
                { name: '火', value: 14 },
                { name: '土', value: 20 },
                { name: '金', value: 10 },
                { name: '水', value: 16 },
            ],
            favorableElement: '火（用神·泄秀调候）',
            unfavorableElement: '木（忌神·比劫）',
            advice: '…',
            interactions: ['寅卯辰三会木局：比劫成势'],
        },
    } as any);

    const data = (normalized as any).data;
    assert.equal(data.elements.wood.strength, 40);
    assert.equal(data.elements.fire.strength, 14);
    assert.equal(data.elements.metal.strength, 10);
    assert.equal(data.favorableElement, 'fire');
    assert.equal(data.unfavorableElement, 'wood');
    assert.equal(data.elements.wood.level, '旺');
    assert.deepEqual(data.interactions, [{ impact: '寅卯辰三会木局：比劫成势' }]);
});

test('normalizeChartData keeps life trend periods that only carry an overall score', async () => {
    const { normalizeChartData } = await import('../lib/visualization/chart-data-extract');
    const normalized = normalizeChartData({
        chartType: 'life_fortune_trend',
        title: '大运',
        data: {
            currentAge: 24,
            currentYear: 2026,
            parsed: true,
            lifeHighlight: '22–31 庚申大限是变动中上位的十年',
            periods: [
                { age: '22-31', label: '庚申·破军禄', score: 72, desc: '变动开创期' },
                { age: '32-41', label: '己未', score: 64, description: '宜守成' },
            ],
        },
    } as any);

    const data = (normalized as any).data;
    assert.equal(data.periods.length, 2);
    assert.deepEqual([data.periods[0].startAge, data.periods[0].endAge], [22, 31]);
    assert.equal(data.periods[0].overall, 72);
    assert.equal(data.periods[0].summary, '变动开创期');
    assert.equal(data.periods[1].summary, '宜守成');
    assert.equal(data.lifeHighlight.currentStatus, '22–31 庚申大限是变动中上位的十年');
});
