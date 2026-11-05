/** The billing center's requests from the browser. */
import { requestBrowserData } from '@/lib/browser-api';
import { openSettingsCenter } from '@/lib/settings-center';
import type {
    AdminBillingUserView, AdminPaymentOrderView, AdminUsagePage, BillingOverview, BillingPaymentView, BillingSettings, BillingSummary,
    DeductOrder, EpayCheckout, EpayCheckoutInput, LedgerPage, PaymentOrderView, RedeemResult, RedemptionCodeView, SubscriptionPlanView,
} from './config';

export type OrdersPage = { orders: PaymentOrderView[]; nextOffset: number | null };
export type AdminOrdersPage = { orders: AdminPaymentOrderView[]; nextOffset: number | null };
export type AdminBillingUserDetail = { user: AdminBillingUserView; summary: BillingSummary; ledger: LedgerPage; orders: PaymentOrderView[] };

const json = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Toast options for a call refused for want of balance: the action opens the wallet. */
export const TOP_UP_TOAST = { action: { label: '去充值', onClick: () => openSettingsCenter('billing') } };

export const fetchBillingOverview = () => requestBrowserData<BillingOverview>('/api/billing', json('GET'), { fallbackMessage: '读取账户失败' });
export const fetchBillingLedger = (query: URLSearchParams) => requestBrowserData<LedgerPage>(`/api/billing/ledger?${query}`, json('GET'), { fallbackMessage: '读取用量日志失败' });
export const fetchBillingOrders = (offset = 0) => requestBrowserData<OrdersPage>(`/api/billing/orders?offset=${offset}`, json('GET'), { fallbackMessage: '读取订单失败' });

export const redeemCode = (code: string) => requestBrowserData<{ result: RedeemResult; summary: BillingSummary | null }>(
    '/api/billing/redeem', json('POST', { code }), { fallbackMessage: '兑换失败' });
export const buyPlan = (planId: string) => requestBrowserData<{ summary: BillingSummary | null }>(
    `/api/billing/plans/${encodeURIComponent(planId)}/buy`, json('POST', {}), { fallbackMessage: '购买失败' });
export const startCheckout = (input: EpayCheckoutInput) =>
    requestBrowserData<EpayCheckout>('/api/billing/epay/checkout', json('POST', input), { fallbackMessage: '创建支付订单失败' });

/** Which purse a charge spends first, saved from the wallet page. */
export const saveDeductOrder = (deductOrder: DeductOrder) => requestBrowserData<{ summary: BillingSummary }>(
    '/api/billing/preferences', json('PATCH', { deductOrder }), { fallbackMessage: '保存扣费顺序失败' });

/** Leaves for the gateway: its pay page takes a signed form post. */
export function submitCheckout(checkout: EpayCheckout) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = checkout.url;
    form.hidden = true;
    for (const [name, value] of Object.entries(checkout.params)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.append(input);
    }
    document.body.append(form);
    form.submit();
    form.remove();
}

// ─── Administrator ───

export const fetchAdminPlans = () => requestBrowserData<{ plans: SubscriptionPlanView[] }>('/api/admin/billing/plans', json('GET'), { fallbackMessage: '读取套餐失败' });
export const saveAdminPlan = (id: string | null, plan: Record<string, unknown>) => requestBrowserData<{ plan: SubscriptionPlanView }>(
    id ? `/api/admin/billing/plans/${encodeURIComponent(id)}` : '/api/admin/billing/plans', json(id ? 'PUT' : 'POST', plan), { fallbackMessage: '保存套餐失败' });
export const deleteAdminPlan = (id: string) => requestBrowserData<{ deleted: boolean }>(
    `/api/admin/billing/plans/${encodeURIComponent(id)}`, json('DELETE'), { fallbackMessage: '删除套餐失败' });

export const fetchAdminCodes = (query: URLSearchParams) => requestBrowserData<{ codes: RedemptionCodeView[] }>(
    `/api/admin/billing/codes?${query}`, json('GET'), { fallbackMessage: '读取兑换码失败' });
export const createAdminCodes = (input: Record<string, unknown>) => requestBrowserData<{ codes: string[] }>(
    '/api/admin/billing/codes', json('POST', input), { fallbackMessage: '生成兑换码失败' });
export const disableAdminCode = (id: string) => requestBrowserData<{ disabled: boolean }>(
    `/api/admin/billing/codes/${encodeURIComponent(id)}`, json('DELETE'), { fallbackMessage: '作废兑换码失败' });

export const searchAdminUsers = (email: string) => requestBrowserData<{ users: AdminBillingUserView[] }>(
    `/api/admin/billing/users?${new URLSearchParams({ email })}`, json('GET'), { fallbackMessage: '查找用户失败' });
export const fetchAdminUser = (id: string, offset = 0) => requestBrowserData<AdminBillingUserDetail>(
    `/api/admin/billing/users/${encodeURIComponent(id)}?offset=${offset}`, json('GET'), { fallbackMessage: '读取用户账户失败' });
export const changeAdminUser = (id: string, action: Record<string, unknown>) => requestBrowserData<{ summary: BillingSummary | null }>(
    `/api/admin/billing/users/${encodeURIComponent(id)}`, json('POST', action), { fallbackMessage: '操作失败' });
export const cancelAdminSubscription = (id: string) => requestBrowserData<{ cancelled: boolean }>(
    `/api/admin/billing/subscriptions/${encodeURIComponent(id)}`, json('DELETE'), { fallbackMessage: '取消订阅失败' });

export const fetchAdminOrders = (query: URLSearchParams) => requestBrowserData<AdminOrdersPage>(
    `/api/admin/billing/orders?${query}`, json('GET'), { fallbackMessage: '读取订单失败' });
export const fetchAdminSettings = () => requestBrowserData<{ settings: BillingSettings; payment: BillingPaymentView }>(
    '/api/admin/billing/settings', json('GET'), { fallbackMessage: '读取计费设置失败' });
export const saveAdminSettings = (settings: BillingSettings) => requestBrowserData<{ settings: BillingSettings }>(
    '/api/admin/billing/settings', json('PUT', { settings }), { fallbackMessage: '保存计费设置失败' });
export const fetchAdminUsage = (query: URLSearchParams) => requestBrowserData<AdminUsagePage>(
    `/api/admin/billing/usage?${query}`, json('GET'), { fallbackMessage: '读取用量日志失败' });
