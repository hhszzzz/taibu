/**
 * 全局搜索能跳到的设置项：每一项对应一个设置页里的区块（`data-settings-highlight`），
 * 搜索打开 `/settings/<tab>?highlight=<anchor>`，设置页滚动到该区块并短暂高亮。
 */
import type { SettingsCenterTab } from '@/lib/settings-center';

export const SETTINGS_HIGHLIGHT_ATTRIBUTE = 'data-settings-highlight';

/** 设置页里有专属图标的条目；没有时用所在分页的图标。 */
export type SettingsSearchIconName = 'bell' | 'memory' | 'schedule' | 'subscription' | 'wallet';

export interface SettingsSearchItem {
    id: string;
    tab: SettingsCenterTab;
    /** Admin sub-tab to open, when the target lives under one. */
    subpath?: string;
    /** The block's data attribute; `panel:<tab>` highlights the whole panel. */
    anchor: string;
    label: string;
    description: string;
    icon?: SettingsSearchIconName;
    keywords: readonly string[];
}

export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
    { id: 'general-appearance', tab: 'general', anchor: 'general-appearance', label: '外观', description: '界面明暗与主题', keywords: ['外观', '主题', '深色', '浅色', '明亮', '明暗'] },
    { id: 'general-preferences', tab: 'general', anchor: 'general-preferences', label: '阅读偏好', description: '全站字号与语言', keywords: ['字号', '字体大小', '阅读', '语言'] },
    { id: 'general-notifications', tab: 'general', anchor: 'general-notifications', label: '通知与提醒', description: '推送通知与浏览器通知', icon: 'bell', keywords: ['通知', '提醒', '推送'] },
    { id: 'general-push', tab: 'general', anchor: 'general-notifications', label: '推送通知', description: '提醒和后台任务完成通知', icon: 'bell', keywords: ['推送通知', '通知', '提醒'] },
    { id: 'general-browser-notification', tab: 'general', anchor: 'general-notifications', label: '浏览器通知', description: '任务完成或失败时的系统通知', icon: 'bell', keywords: ['浏览器通知', '系统通知', '桌面通知'] },
    { id: 'profile-profile', tab: 'profile', anchor: 'profile-profile', label: '个人资料', description: '昵称与头像', keywords: ['昵称', '头像', '个人资料', '账户'] },
    { id: 'profile-security', tab: 'profile', anchor: 'profile-security', label: '安全', description: '邮箱与密码', keywords: ['密码', '邮箱', '安全', '登录'] },
    { id: 'billing-wallet', tab: 'billing', anchor: 'billing-wallet', label: '钱包', description: '余额与订阅额度', icon: 'wallet', keywords: ['余额', '钱包', '额度', '充值'] },
    { id: 'billing-subscription-quota', tab: 'billing', anchor: 'billing-wallet', label: '订阅额度', description: '优先扣订阅还是余额', icon: 'subscription', keywords: ['订阅额度', '额度', '扣费顺序'] },
    { id: 'billing-subscriptions', tab: 'billing', anchor: 'billing-subscriptions', label: '我的订阅', description: '当前套餐与到期时间', icon: 'subscription', keywords: ['订阅', '套餐', '会员'] },
    { id: 'billing-orders', tab: 'billing', anchor: 'billing-orders', label: '支付订单', description: '订单与支付记录', keywords: ['订单', '支付', '账单'] },
    { id: 'billing-plans', tab: 'billing', anchor: 'billing-plans', label: '订阅套餐', description: '可开通的套餐与价格', keywords: ['订阅', '套餐', '会员', '价格'] },
    { id: 'billing-topup', tab: 'billing', anchor: 'billing-topup', label: '充值', description: '在线充值与金额', keywords: ['充值', '支付', '扫码'] },
    { id: 'billing-redeem', tab: 'billing', anchor: 'billing-redeem', label: '兑换码', description: '兑换订阅或余额', keywords: ['兑换码', '兑换', '激活码'] },
    { id: 'usage-log', tab: 'usage-log', anchor: 'panel:usage-log', label: '用量日志', description: '模型调用与费用明细', keywords: ['用量', '费用', '日志', '账单'] },
    { id: 'shares', tab: 'shares', anchor: 'panel:shares', label: '分享链接', description: '公开分享过的对话', keywords: ['分享', '公开链接', '链接'] },
    { id: 'personalization', tab: 'personalization', anchor: 'panel:personalization', label: '个性化', description: '带入对话与解读的偏好', keywords: ['个性化', '偏好', '解读'] },
    { id: 'personalization-style', tab: 'personalization', anchor: 'personalization-style', label: '解读风格', description: '身份与表达方式', keywords: ['解读风格', '风格', '身份', '语气', '表达'] },
    { id: 'personalization-visualization', tab: 'personalization', anchor: 'personalization-visualization', label: '运势可视化', description: '图表维度与风格', keywords: ['可视化', '图表', '运势图', '维度'] },
    { id: 'personalization-memory', tab: 'personalization', anchor: 'personalization-memory', label: '记忆', description: '长期记忆与已保存记忆', icon: 'memory', keywords: ['记忆', '长期记忆', '偏好'] },
    { id: 'byok', tab: 'byok', anchor: 'panel:byok', label: '自定义模型', description: '自己的模型服务与密钥', keywords: ['模型', '密钥', 'API', '自定义模型', '自带模型'] },
    { id: 'byok-key', tab: 'byok', anchor: 'panel:byok', label: '模型密钥', description: 'Key 保存位置与连接', keywords: ['密钥', 'API Key', 'Key', '连接'] },
    { id: 'charts-bazi', tab: 'charts', anchor: 'charts-bazi', label: '八字命盘', description: '保存过的八字命盘', keywords: ['命盘', '八字', '默认命盘'] },
    { id: 'charts-ziwei', tab: 'charts', anchor: 'charts-ziwei', label: '紫微命盘', description: '保存过的紫微命盘', keywords: ['命盘', '紫微'] },
    { id: 'charts-default', tab: 'charts', anchor: 'charts-bazi', label: '默认命盘', description: '日运、月运与每日早报使用的命盘', keywords: ['默认命盘', '默认', '日运', '月运', '早报'] },
    { id: 'knowledge-base-list', tab: 'knowledge-base', anchor: 'kb-list', label: '知识库', description: '知识库与归档资料', keywords: ['知识库', '资料', '归档'] },
    { id: 'knowledge-base-import', tab: 'knowledge-base', anchor: 'kb-import', label: '导入外部资料', description: '上传文件或导入内容', keywords: ['导入', '上传', '文件'] },
    { id: 'skills', tab: 'skills', anchor: 'panel:skills', label: '技能', description: 'Agent 技能与方法', keywords: ['技能', '方法', 'skill'] },
    { id: 'connectors', tab: 'connectors', anchor: 'panel:connectors', label: '连接器', description: '自己的 MCP 服务', keywords: ['连接器', 'MCP'] },
    { id: 'mcp-service', tab: 'mcp-service', anchor: 'panel:mcp-service', label: 'Taibu MCP', description: '在其他客户端调用排盘工具', keywords: ['MCP', '客户端', '接口'] },
    { id: 'help', tab: 'help', anchor: 'panel:help', label: '帮助', description: '常见问题与联系方式', keywords: ['帮助', '常见问题', '联系'] },
    { id: 'admin-announcements', tab: 'admin-announcements', anchor: 'panel:admin-announcements', label: '公告', description: '站内公告管理', keywords: ['公告', '通知'] },
    { id: 'admin-features', tab: 'admin-features', anchor: 'panel:admin-features', label: '功能开关', description: '按模块关闭入口与接口', keywords: ['功能开关', '模块', '关闭'] },
    { id: 'admin-billing', tab: 'admin-billing', anchor: 'panel:admin-billing', label: '计费管理', description: '余额、套餐、订单与充值设置', keywords: ['计费', '余额', '套餐', '订单'] },
    { id: 'admin-billing-users', tab: 'admin-billing', subpath: 'users', anchor: 'panel:admin-billing', label: '用户账户', description: '管理员调整余额与账户', keywords: ['用户', '账户', '余额', '调余额'] },
    { id: 'admin-billing-plans', tab: 'admin-billing', subpath: 'plans', anchor: 'panel:admin-billing', label: '套餐管理', description: '订阅套餐与价格', keywords: ['套餐', '订阅', '价格'] },
    { id: 'admin-billing-codes', tab: 'admin-billing', subpath: 'codes', anchor: 'panel:admin-billing', label: '兑换码', description: '生成与管理兑换码', keywords: ['兑换码', '兑换', '激活码'] },
    { id: 'admin-billing-orders', tab: 'admin-billing', subpath: 'orders', anchor: 'panel:admin-billing', label: '订单管理', description: '支付订单与退款', keywords: ['订单', '支付', '退款'] },
    { id: 'admin-billing-settings', tab: 'admin-billing', subpath: 'settings', anchor: 'panel:admin-billing', label: '充值设置', description: '在线充值开关与金额', keywords: ['充值', '充值设置', '支付'] },
    { id: 'admin-ai-services', tab: 'admin-ai-services', anchor: 'panel:admin-ai-services', label: 'AI 服务', description: '模型、来源、网关与测评', keywords: ['模型', '网关', '来源', 'AI'] },
    { id: 'admin-ai-models', tab: 'admin-ai-services', subpath: 'models', anchor: 'panel:admin-ai-services', label: '模型管理', description: '平台模型与单价', keywords: ['模型', '单价', '定价'] },
    { id: 'admin-ai-gateways', tab: 'admin-ai-services', subpath: 'gateways', anchor: 'panel:admin-ai-services', label: '网关管理', description: '模型网关与密钥', keywords: ['网关', '密钥', 'API'] },
    { id: 'admin-ai-byok', tab: 'admin-ai-services', subpath: 'byok', anchor: 'panel:admin-ai-services', label: '自定义模型策略', description: '成员自带模型与 Key 策略', keywords: ['自定义模型', 'BYOK', '密钥'] },
    { id: 'admin-ai-evals', tab: 'admin-ai-services', subpath: 'agent-evals', anchor: 'panel:admin-ai-services', label: 'Agent 测评', description: '模型与方法测评', keywords: ['测评', '评测', 'Agent'] },
    { id: 'admin-agent-extensions', tab: 'admin-agent-extensions', anchor: 'panel:admin-agent-extensions', label: 'Agent 扩展', description: 'MCP、联网搜索、技能与角色', keywords: ['Agent', '扩展', 'MCP', '搜索', '角色'] },
    { id: 'admin-agent-mcp', tab: 'admin-agent-extensions', subpath: 'mcp', anchor: 'panel:admin-agent-extensions', label: '平台 MCP', description: '平台 MCP 服务', keywords: ['MCP', '服务'] },
    { id: 'admin-agent-skills', tab: 'admin-agent-extensions', subpath: 'skills', anchor: 'panel:admin-agent-extensions', label: '平台技能', description: '平台技能库', keywords: ['技能', '方法'] },
    { id: 'admin-agent-profiles', tab: 'admin-agent-extensions', subpath: 'profiles', anchor: 'panel:admin-agent-extensions', label: '智能体角色', description: 'Agent 角色与提示词', keywords: ['角色', '智能体', 'Agent'] },
    { id: 'admin-agent-policy', tab: 'admin-agent-extensions', subpath: 'policy', anchor: 'panel:admin-agent-extensions', label: '用户扩展权限', description: '成员可用的扩展能力', keywords: ['权限', '扩展', '用户'] },
    { id: 'admin-agent-schedules', tab: 'admin-agent-extensions', subpath: 'schedules', anchor: 'panel:admin-agent-extensions', label: '定时任务额度', description: '成员定时任务上限', icon: 'schedule', keywords: ['定时任务', '额度', '上限'] },
    { id: 'admin-logs', tab: 'admin-logs', anchor: 'panel:admin-logs', label: '日志', description: '全站用量、Agent 与定时任务记录', keywords: ['日志', '运行记录', '任务'] },
    { id: 'admin-logs-usage', tab: 'admin-logs', subpath: 'usage', anchor: 'panel:admin-logs', label: '用量日志', description: '全站模型调用与费用', keywords: ['用量', '费用', '日志'] },
    { id: 'admin-logs-agent-tasks', tab: 'admin-logs', subpath: 'agent-tasks', anchor: 'panel:admin-logs', label: 'Agent 任务', description: '全站 Agent 任务记录', keywords: ['Agent', '任务', '运行记录'] },
    { id: 'admin-logs-schedules', tab: 'admin-logs', subpath: 'schedules', anchor: 'panel:admin-logs', label: '定时任务日志', description: '全站定时任务运行记录', icon: 'schedule', keywords: ['定时任务', '运行记录'] },
    { id: 'admin-logs-deployment', tab: 'admin-logs', subpath: 'deployment', anchor: 'panel:admin-logs', label: '部署日志', description: '版本与部署记录', keywords: ['部署', '版本', '更新'] },
];

/** Settings items matching a keyword, in registry order. */
export function matchSettingsSearchItems(keyword: string, tabs: readonly SettingsCenterTab[]): SettingsSearchItem[] {
    const query = keyword.trim().toLowerCase();
    if (!query) return [];
    const available = new Set(tabs);
    return SETTINGS_SEARCH_ITEMS.filter(item => available.has(item.tab)
        && [item.label, item.description, ...item.keywords].some(text => text.toLowerCase().includes(query)));
}

/** 空搜索框时先给几项常用设置，避免「设置」分类一片空白。 */
const RECOMMENDED_SETTINGS = new Set([
    'general-appearance', 'general-notifications', 'billing-wallet', 'charts-default',
    'byok', 'knowledge-base-list', 'skills', 'personalization-memory',
]);

export function recommendedSettingsSearchItems(tabs: readonly SettingsCenterTab[]): SettingsSearchItem[] {
    const available = new Set(tabs);
    return SETTINGS_SEARCH_ITEMS.filter(item => available.has(item.tab) && RECOMMENDED_SETTINGS.has(item.id));
}
