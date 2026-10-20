/**
 * Saving an Agent chart to the user's chart library is the user's choice, as on the bazi and ziwei result pages: the
 * board offers it and posts the same payload those pages post. A chart counts as saved when the library holds one with
 * the same birth identity, whichever page saved it, so the board stays right after a refresh or a delete.
 */
import { resolveBirthTimeOptions } from '@/lib/divination/birth-time';
import type { UserChartBundle, UserChartRecord, UserChartType } from '@/lib/user/charts-client';

// A type alias, not an interface: the payload is posted as a plain record.
export type AgentChartSavePayload = {
  name: string;
  gender: 'male' | 'female';
  birth_date: string;
  birth_time: string;
  calendar_type: 'solar' | 'lunar';
  is_leap_month: boolean;
  birth_place: string | null;
  longitude: number | null;
  timezone: string;
  disambiguation: string;
};

export interface AgentChartSave { type: UserChartType; payload: AgentChartSavePayload }

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/**
 * The library payload of a completed bazi or ziwei calculation, or null when the chart tables cannot hold it: another
 * day boundary or calculation options, or a lunar date that is no calendar date (the tables keep a SQL date).
 */
export function getAgentChartSave(tool: { name: string; status: string; input?: unknown }): AgentChartSave | null {
  if (tool.status !== 'completed' || (tool.name !== 'bazi' && tool.name !== 'ziwei')) return null;
  const args = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input) ? tool.input as Record<string, unknown> : null;
  if (!args || (args.dayBoundary !== undefined && args.dayBoundary !== 'midnight') || args.calculationOptions !== undefined) return null;
  const { gender, birthYear, birthMonth, birthDay, birthHour } = args;
  const minute = args.birthMinute ?? 0;
  if (gender !== 'male' && gender !== 'female') return null;
  if (![birthYear, birthMonth, birthDay, birthHour, minute].every(Number.isInteger)) return null;
  const birthDate = `${pad(birthYear as number, 4)}-${pad(birthMonth as number)}-${pad(birthDay as number)}`;
  const date = new Date(`${birthDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birthDate) return null;
  let options;
  try { options = resolveBirthTimeOptions(args); } catch { return null; }
  return {
    type: tool.name,
    payload: {
      name: `${gender === 'female' ? '女' : '男'}命 ${birthDate}`,
      gender,
      birth_date: birthDate,
      birth_time: `${pad(birthHour as number)}:${pad(minute as number)}`,
      calendar_type: args.calendarType === 'lunar' ? 'lunar' : 'solar',
      is_leap_month: args.isLeapMonth === true,
      birth_place: typeof args.birthPlace === 'string' && args.birthPlace.trim() ? args.birthPlace.trim() : null,
      longitude: typeof args.longitude === 'number' && Number.isFinite(args.longitude) ? args.longitude : null,
      ...options,
    },
  };
}

/** The birth identity a chart is the same chart by; the name and place are labels, not identity. */
function identity(row: {
  gender?: unknown; birth_date?: unknown; birth_time?: unknown; calendar_type?: unknown; is_leap_month?: unknown;
  longitude?: unknown; timezone?: unknown; disambiguation?: unknown;
}): string | null {
  let options;
  try { options = resolveBirthTimeOptions(row); } catch { return null; }
  if (typeof row.birth_date !== 'string' || typeof row.birth_time !== 'string') return null;
  const longitude = row.longitude === null || row.longitude === undefined ? null : Number(row.longitude);
  return JSON.stringify([
    row.gender ?? null, row.birth_date, row.birth_time.slice(0, 5), row.calendar_type === 'lunar' ? 'lunar' : 'solar',
    row.is_leap_month === true, Number.isFinite(longitude) ? longitude : null, options.timezone, options.disambiguation,
  ]);
}

/** The library chart that is this calculation's chart, if the user saved it on any page. */
export function findSavedAgentChart(bundle: UserChartBundle | null | undefined, save: AgentChartSave): UserChartRecord | null {
  const key = identity(save.payload);
  const rows = save.type === 'bazi' ? bundle?.baziCharts : bundle?.ziweiCharts;
  return key === null ? null : rows?.find(row => identity(row) === key) ?? null;
}

export function getSavedChartHref(type: UserChartType, id: string): string {
  return `/${type}/result?chart=${encodeURIComponent(id)}`;
}
