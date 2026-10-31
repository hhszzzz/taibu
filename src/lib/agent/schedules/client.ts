/**
 * Browser calls for 定时任务 and the administrator's limit form.
 * The account id pins every request to the page's owner, as the extension settings do.
 */
import { requestBrowserData } from '@/lib/browser-api';
import type { AgentScheduleInput, AgentScheduleLimits, AgentScheduleRunView, AgentScheduleView } from './config';

export type AgentScheduleAllowance = { limit: number; used: number };
export type AgentScheduleListing = { schedules: AgentScheduleView[]; allowance: AgentScheduleAllowance };

export type AgentScheduleClient = ReturnType<typeof agentScheduleClient>;

export function agentScheduleClient(userId?: string) {
  const call = <T>(path: string, method: string, fallbackMessage: string, body?: unknown, signal?: AbortSignal) =>
    requestBrowserData<T>(`/api/agent/schedules${path}`, {
      method, signal,
      ...(userId ? { headers: { 'X-Expected-User-Id': userId } } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { fallbackMessage });
  const path = (id: string, suffix = '') => `/${encodeURIComponent(id)}${suffix}`;
  return {
    list: (signal?: AbortSignal) => call<AgentScheduleListing>('', 'GET', '读取定时任务失败', undefined, signal),
    create: async (input: AgentScheduleInput) => (await call<{ schedule: AgentScheduleView }>('', 'POST', '创建定时任务失败', input)).schedule,
    update: async (id: string, input: Partial<AgentScheduleInput> & { enabled?: boolean }) =>
      (await call<{ schedule: AgentScheduleView }>(path(id), 'PATCH', '保存定时任务失败', input)).schedule,
    remove: (id: string) => call<{ deleted: boolean }>(path(id), 'DELETE', '删除定时任务失败'),
    run: async (id: string) => (await call<{ run: AgentScheduleRunView }>(path(id, '/run'), 'POST', '立即运行失败')).run,
    runs: async (id: string, signal?: AbortSignal) =>
      (await call<{ runs: AgentScheduleRunView[] }>(path(id, '/runs'), 'GET', '读取运行历史失败', undefined, signal)).runs,
  };
}

export async function fetchAgentScheduleLimits(signal?: AbortSignal): Promise<AgentScheduleLimits> {
  return (await requestBrowserData<{ limits: AgentScheduleLimits }>('/api/admin/agent-schedules/limits', { signal }, { fallbackMessage: '读取定时任务额度失败' })).limits;
}

export async function saveAgentScheduleLimits(limits: AgentScheduleLimits): Promise<AgentScheduleLimits> {
  return (await requestBrowserData<{ limits: AgentScheduleLimits }>('/api/admin/agent-schedules/limits', {
    method: 'PUT', body: JSON.stringify({ limits }),
  }, { fallbackMessage: '保存定时任务额度失败' })).limits;
}
