import 'server-only';
import { toBaziJson, toBaziText } from 'taibu-core/bazi';
import { toZiweiJson, toZiweiText } from 'taibu-core/ziwei';
import { toQimenJson, toQimenText } from 'taibu-core/qimen';
import { toLiuyaoJson, toLiuyaoText } from 'taibu-core/liuyao';
import { toDaliurenJson, type DaliurenOutput } from 'taibu-core/daliuren';
import { buildMeihuaCanonicalJson as buildMeihuaCanonicalJSON } from '@/lib/divination/meihua';
import { buildXiaoliurenCanonicalJson as buildXiaoliurenCanonicalJSON } from '@/lib/divination/xiaoliuren';
import { buildTarotCanonicalJSON, TAROT_SPREADS } from '@/lib/divination/tarot';
import { calculateQimenBundle } from '@/lib/divination/qimen';
import { qimenInputFromRecord } from '@/lib/data-sources/qimen';
import { calculateLiuyaoBundle, findHexagram } from '@/lib/divination/liuyao';
import { buildYaosFromCode } from '@/lib/data-sources/liuyao';
import { getProvider } from '@/lib/data-sources';
import { resolveBaziPromptData } from '@/lib/bazi-prompt';
import { resolveZiweiPromptData } from '@/lib/ziwei-chart-prompt';
import { resolveBirthTimeOptions } from '@/lib/divination/birth-time';
import type { AgentStore, AgentRunRow } from './store.server';
import { getAgentChart } from './tool-presentation';
import { isAgentChartTool } from './tool-catalog';
import { CHART_SOURCE_KINDS, parseChartReference, type ChartSource } from './chart-interaction';

/** Check ownership on every execution and cache replay, independent of model arguments. */
export async function authorizeChartReference(store: AgentStore, run: AgentRunRow, reference: unknown) {
  const parsed = parseChartReference(reference);
  if (!parsed) throw new Error('命盘引用格式不正确');
  if (parsed.source === 'artifact') {
    const artifact = await store.chartArtifact(run, parsed.id);
    if (!artifact || !isAgentChartTool(artifact.tool_name)) throw new Error('命盘不在当前会话中或无权访问');
    return artifact.tool_name;
  }
  const query = (() => {
    switch (parsed.source) {
      case 'bazi_chart': return store.db.from('bazi_charts');
      case 'ziwei_chart': return store.db.from('ziwei_charts');
      case 'qimen_chart': return store.db.from('qimen_charts');
      case 'liuyao_divination': return store.db.from('liuyao_divinations');
      case 'meihua_divination': return store.db.from('meihua_divinations');
      case 'daliuren_divination': return store.db.from('daliuren_divinations');
      case 'xiaoliuren_divination': return store.db.from('xiaoliuren_divinations');
      case 'tarot_reading': return store.db.from('tarot_readings');
    }
  })();
  const { data, error } = await query.select('id').eq('id', parsed.id).eq('user_id', run.user_id).maybeSingle();
  if (error || !data) throw new Error('命盘不存在或无权访问');
  return CHART_SOURCE_KINDS[parsed.source];
}

async function storedChart(source: ChartSource, row: Record<string, unknown>, provider: Awaited<ReturnType<typeof getProvider>>, store: AgentStore) {
  let json: unknown;
  let canonicalText: string | undefined;
  const saved = row.result_data as { result?: unknown } | undefined;
  if (source === 'meihua_divination' && saved?.result) json = buildMeihuaCanonicalJSON(saved.result as Parameters<typeof buildMeihuaCanonicalJSON>[0]);
  if (source === 'xiaoliuren_divination' && saved?.result) json = buildXiaoliurenCanonicalJSON(saved.result as Parameters<typeof buildXiaoliurenCanonicalJSON>[0]);
  if (source === 'daliuren_divination' && saved) json = toDaliurenJson(saved as DaliurenOutput);
  if (source === 'tarot_reading') {
    const metadata = row.metadata as Record<string, unknown> | null;
    const spread = TAROT_SPREADS.find(spread => spread.id === row.spread_id);
    json = buildTarotCanonicalJSON({ spreadName: spread?.name ?? String(row.spread_id ?? '塔罗占卜'), spreadId: typeof row.spread_id === 'string' ? row.spread_id : undefined,
      question: typeof row.question === 'string' ? row.question : undefined, cards: row.cards,
      seed: typeof metadata?.seed === 'string' ? metadata.seed : undefined,
      birthDate: typeof metadata?.birthDate === 'string' ? metadata.birthDate : undefined,
      numerology: metadata?.numerology as Parameters<typeof buildTarotCanonicalJSON>[0]['numerology'] });
  }
  if (source === 'qimen_chart') {
    const { output } = await calculateQimenBundle(qimenInputFromRecord(row as Parameters<typeof qimenInputFromRecord>[0]));
    json = toQimenJson(output); canonicalText = toQimenText(output);
  }
  if (source === 'liuyao_divination') {
    const code = typeof row.hexagram_code === 'string' ? row.hexagram_code : '';
    const hexagram = /^[01]{6}$/.test(code) ? findHexagram(code) : undefined;
    const changedHexagram = typeof row.changed_hexagram_code === 'string' ? findHexagram(row.changed_hexagram_code) : undefined;
    const targets = Array.isArray(row.yongshen_targets) ? row.yongshen_targets.filter((item): item is '父母' | '兄弟' | '子孙' | '妻财' | '官鬼' => typeof item === 'string' && ['父母', '兄弟', '子孙', '妻财', '官鬼'].includes(item)) : [];
    if (hexagram && typeof row.question === 'string' && row.question.trim() && targets.length) {
      const changed = Array.isArray(row.changed_lines) ? row.changed_lines.filter((line): line is number => typeof line === 'number' && Number.isInteger(line) && line >= 1 && line <= 6) : [];
      const bundle = calculateLiuyaoBundle({ yaos: buildYaosFromCode(code, changed), hexagram, changedHexagram, question: row.question, yongShenTargets: targets, date: new Date(String(row.created_at)) });
      json = toLiuyaoJson(bundle.output); canonicalText = toLiuyaoText(bundle.output);
    }
  }
  if (!json) throw new Error('已存结果不完整，无法恢复交互盘面，请查看原记录');
  return { json, canonicalText: canonicalText ?? await provider.formatForAI(row, { client: store.db }) };
}

export async function loadAgentChart(store: AgentStore, run: AgentRunRow, reference: string) {
  const parsed = parseChartReference(reference);
  if (!parsed) throw new Error('命盘引用格式不正确');
  const normalized = parsed.source + ':' + parsed.id;
  if (parsed.source === 'artifact') {
    const artifact = await store.chartArtifact(run, parsed.id);
    const snapshot = artifact?.result.chartSnapshot?.kind === artifact?.tool_name ? artifact?.result.chartSnapshot : null;
    const value = artifact ? getAgentChart({ type: 'tool', id: artifact.id, name: artifact.tool_name, title: artifact.tool_name,
      status: 'completed', output: { result: snapshot?.result ?? artifact.result.details } }) : null;
    if (!value) throw new Error('命盘不在当前会话中、无权访问或结果不完整');
    return { reference: normalized, value, canonicalText: snapshot?.canonicalText ?? artifact!.result.canonicalText ?? artifact!.result.content.map(part => part.text).join('\n') };
  }
  const provider = await getProvider(parsed.source);
  const row = await provider.get(parsed.id, run.user_id, { client: store.db }) as Record<string, unknown> | null;
  if (!row) throw new Error('命盘不存在或无权访问');
  if (parsed.source !== 'bazi_chart' && parsed.source !== 'ziwei_chart') {
    const { json, canonicalText } = await storedChart(parsed.source, row, provider, store);
    const kind = CHART_SOURCE_KINDS[parsed.source];
    const value = getAgentChart({ type: 'tool', id: parsed.id, name: kind, title: kind, status: 'completed', output: json });
    if (!value) throw new Error('命盘数据不完整，无法显示');
    return { reference: normalized, value, canonicalText };
  }
  const string = (key: string) => typeof row[key] === 'string' ? row[key] as string : undefined;
  const input = {
    name: string('name'), gender: string('gender'), birthDate: string('birth_date'), birthTime: string('birth_time'),
    birthPlace: string('birth_place'), longitude: typeof row.longitude === 'number' ? row.longitude : undefined,
    calendarType: row.calendar_type === 'lunar' ? 'lunar' as const : 'solar' as const, isLeapMonth: row.is_leap_month === true,
    ...resolveBirthTimeOptions(row),
  };
  const bazi = parsed.source === 'bazi_chart' ? resolveBaziPromptData(input) : null;
  const ziwei = parsed.source === 'ziwei_chart' ? resolveZiweiPromptData(input) : null;
  const kind = bazi ? 'bazi' : 'ziwei';
  const json = bazi ? toBaziJson(bazi.output) : ziwei ? toZiweiJson(ziwei.output) : null;
  const value = getAgentChart({ type: 'tool', id: parsed.id, name: kind, title: kind, status: 'completed', output: json });
  if (!value) throw new Error('命盘数据不完整，无法显示');
  return { reference: normalized, value, canonicalText: bazi ? toBaziText(bazi.output) : toZiweiText(ziwei!.output) };
}

/** Focus uses the immutable inspected snapshot, even if a saved birth record is later edited. */
export async function loadInspectedChart(store: AgentStore, run: AgentRunRow, reference: string) {
  const parsed = parseChartReference(reference);
  if (!parsed) throw new Error('命盘引用格式不正确');
  const normalized = parsed.source + ':' + parsed.id;
  const artifact = await store.inspectedChart(run, normalized);
  const value = artifact ? getAgentChart({ type: 'tool', id: artifact.id, name: 'inspect_chart', title: '命盘', status: 'completed', output: artifact.result.details }) : null;
  if (!value) throw new Error('请先使用 inspect_chart 查看这张命盘');
  return { reference: normalized, value };
}
