/**
 * TaiBu 类型定义
 * 
 * 这个文件集中定义项目中使用的所有 TypeScript 类型
 * 便于类型复用和统一管理
 */

import type { Mention } from '@/types/mentions';
import type { ConversationSourceType } from '@/lib/source-contracts';
import type { InjectedSource } from '@/lib/source-tracker';
import type {
    DiZhi,
    HiddenStemInfo,
    TianGan,
    TrueSolarTimeInfo as CoreTrueSolarTimeInfo,
    WuXing,
} from 'taibu-core';
export type { ConversationSourceType } from '@/lib/source-contracts';

// ===== 基础类型 =====

/** 性别 */
export type Gender = 'male' | 'female';

/** 农历/公历/四柱 */
export type CalendarType = 'solar' | 'lunar' | 'pillars';

// ===== 八字相关类型 =====

/** 天干 */
export type HeavenlyStem = TianGan;

/** 地支 */
export type EarthlyBranch = DiZhi;

/** 五行 */
export type FiveElement = WuXing;

/** 十神 */
export type TenGod = HiddenStemInfo['tenGod'];

export type TrueSolarTimeInfo = CoreTrueSolarTimeInfo;

/** 简化的柱数据（用于四柱输入） */
export interface PillarData {
    stem: HeavenlyStem | '';      // 天干（空字符串表示未选择）
    branch: EarthlyBranch | '';   // 地支（空字符串表示未选择）
}

export type HiddenStemDetail = HiddenStemInfo;

/** 八字输入表单数据 */
export interface BaziFormData {
    name: string;
    gender: Gender;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    birthHour: number;
    birthMinute: number;
    birthPlace?: string;
    longitude?: number;
    calendarType: CalendarType;
    isLeapMonth?: boolean;
    isUnknownTime?: boolean;
    // 新增：四柱模式数据
    pillars?: {
        year: PillarData;
        month: PillarData;
        day: PillarData;
        hour: PillarData;
    };
}

// ===== AI 对话相关类型 =====

/** AI 人格类型 */
export type AIPersonality = 'bazi' | 'ziwei' | 'dream' | 'mangpai' | 'tarot' | 'liuyao' | 'mbti' | 'hepan' | 'qimen' | 'daliuren' | 'meihua' | 'xiaoliuren' | 'general';

/** AI 人格配置 */
export interface AIPersonalityConfig {
    id: AIPersonality;
    name: string;        // 显示名称
    title: string;       // 称号
    description: string; // 风格描述
    emoji: string;       // 图标
    systemPrompt: string; // 系统提示词
    // 扩展字段（可选）
    color?: string;      // 主题色
    greeting?: string;   // 欢迎语
    traits?: string[];   // 人格特征标签
}

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** 消息版本（用于编辑历史） */
export interface MessageVersion {
    userContent: string;
    mentions?: Mention[];
    aiContent: string;
    createdAt: string;
    // 编辑时被截断的后续消息（用于保留分支历史）
    subsequentMessages?: ChatMessage[];
}

/** 消息附件信息（仅用户消息） */
export interface MessageAttachment {
    fileName: string;              // 文件名（含后缀）
    webSearchEnabled?: boolean;    // 是否启用了网络搜索
}

/** 解梦信息 */
export interface DreamInterpretationInfo {
    userName: string;        // 解梦用户名
    dreamDate: string;       // 梦境日期（ISO 格式）
    dreamContent: string;    // 梦境内容摘要（前50字）
    baziChartName?: string;  // 使用的八字命盘名称（如果有）
}

/** 聊天消息 */
export interface ChatMessage {
    id: string;
    role: MessageRole;
    content: string;
    createdAt: string;
    // 提及信息（仅用户消息）- 用于渲染高亮与复用输入框颜色
    mentions?: Mention[];
    model?: string;                   // 使用的模型（仅AI消息）
    modelName?: string;               // 使用的模型名称（仅AI消息）
    reasoning?: string;               // 推理/思考过程（仅AI消息）
    reasoningStartTime?: number;      // 推理开始时间戳（ms）（仅AI消息，流式时使用）
    reasoningDuration?: number;       // 推理用时（秒）（仅AI消息，流式结束后设置）
    metadata?: Record<string, unknown>;
    // 版本支持（仅用户消息有效）
    versions?: MessageVersion[];      // 所有版本历史
    currentVersionIndex?: number;     // 当前显示的版本索引
    // 命盘信息（仅AI消息）- 记录生成该消息时使用的命盘
    chartInfo?: {
        baziName?: string;
        ziweiName?: string;
        baziAnalysisMode?: 'traditional' | 'mangpai';
    };
    // 附件信息（仅用户消息）- 记录发送该消息时使用的附件/搜索
    attachments?: MessageAttachment;
    // 解梦信息（解梦模式消息）
    dreamInfo?: DreamInterpretationInfo;
}

export type { InjectedSource };

/** 提示词层优先级 */
export type PromptLayerPriority = 'P0' | 'P1' | 'P2';

/** 提示词层诊断信息 */
export interface PromptLayerDiagnostic {
    id: string;
    priority: PromptLayerPriority;
    included: boolean;
    tokens: number;
    truncated: boolean;
    reason?: 'budget_exceeded' | 'empty' | 'duplicate';
}

/** 提示词诊断汇总 */
export interface PromptDiagnostics {
    modelId?: string;  // 用于判断是否匹配当前选择的模型
    layers: PromptLayerDiagnostic[];
    totalTokens: number;
    budgetTotal: number;
    userMessageTokens?: number;
}

/**
 * 匿名用户显示名（用于隐私保护）
 * @description 当用户未设置昵称时使用此常量，避免暴露邮箱等 PII
 */
export const ANONYMOUS_DISPLAY_NAME = '用户';

/**
 * AI 消息元数据
 * @description 包含 AI 响应的附加信息，如数据源引用、知识库命中、解梦上下文等
 * 
 * @example
 * ```typescript
 * const metadata: AIMessageMetadata = {
 *   sources: [{ type: 'knowledge_base', id: '...', name: '...', preview: '...', tokens: 100, truncated: false }],
 *   kbSearchEnabled: true,
 *   kbHitCount: 3,
 *   dreamContext: { baziChartName: '张三', dailyFortune: '已参考' }
 * };
 * ```
 */
// extends Record<string, unknown> 是必要的：ChatMessage.metadata 类型为 Record<string, unknown>，
// 需要 AIMessageMetadata 可赋值给该类型。已知属性仍受类型检查保护。
export interface AIMessageMetadata extends Record<string, unknown> {
    /** 注入的数据源列表（知识库、数据源、@提及） */
    sources: InjectedSource[];
    /** 是否启用知识库搜索 */
    kbSearchEnabled?: boolean;
    /** 知识库命中数量 */
    kbHitCount?: number;
    /**
     * 解梦模式上下文
     * @description 仅在解梦模式下填充，包含用于解梦的命盘和运势参考信息
     * - baziChartName: 使用的八字命盘名称（用于前端显示"已参考"）
     * - dailyFortune: 今日运势参考状态，固定值 '已参考' 或 undefined
     */
    dreamContext?: {
        baziChartName?: string;
        dailyFortune?: string;
    };
    /** 提示词诊断信息 */
    promptDiagnostics?: PromptDiagnostics;
}

export type { MentionType, Mention, MentionTarget } from '@/types/mentions';

/** 对话会话 */
export interface Conversation {
    id: string;
    userId?: string;
    personality: AIPersonality;
    title: string;
    messages: ChatMessage[];
    createdAt: string;
    updatedAt: string;
    // 新增：AI 分析来源
    sourceType?: ConversationSourceType;
    sourceData?: Record<string, unknown>;
    isArchived?: boolean;
    archivedKbIds?: string[];
}

export interface ConversationListItem {
    id: string;
    userId?: string;
    personality: AIPersonality;
    title: string;
    createdAt: string;
    updatedAt: string;
    sourceType?: ConversationSourceType;
    questionPreview?: string | null;
    isArchived?: boolean;
    archivedKbIds?: string[];
}

// ===== AI 模型相关类型 =====

/** AI 供应商 */
export type KnownAIVendor =
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'deepseek'
    | 'glm'
    | 'gemini'
    | 'qwen'
    | 'moonshot'
    | 'xai'
    | 'minimax';

export type AIVendor = KnownAIVendor | (string & {});

/** AI 模型用途 */
export type AIUsageType = 'chat' | 'vision' | 'embedding' | 'rerank';

/** AI 来源传输协议 */
export type AITransport = 'openai_compatible';

/** AI 来源路由模式 */
export type AIRoutingMode = 'auto' | 'newapi' | 'octopus';

/** AI 推理努力等级 */
export type AIReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/** AI 推理努力参数序列化方式 */
export type AIReasoningEffortFormat = 'reasoning_object' | 'reasoning_effort';

/** AI 模型来源 */
export interface AIModelSourceConfig {
    sourceKey: string;
    sourceName: string;
    apiUrl: string;
    apiKeyEnvVar: string;
    modelIdOverride?: string | null;
    reasoningModelId?: string | null;
    transport?: AITransport;
    priority?: number;
    isActive?: boolean;
    isEnabled?: boolean;
}

/** AI 模型配置 */
export interface AIModelConfig {
    id: string;                  // 唯一 ID: deepseek-v3, deepseek-pro, etc
    name: string;                // 显示名称
    vendor: AIVendor;            // 供应商
    usageType?: AIUsageType;     // 模型用途
    routingMode?: AIRoutingMode; // 来源路由模式
    modelId: string;             // API 模型 ID
    apiUrl: string;              // API 端点
    apiKeyEnvVar: string;        // API Key 环境变量名
    // 推理模式支持
    supportsReasoning: boolean;  // 是否支持推理模式
    reasoningModelId?: string;   // 推理模式的模型 ID（如果不同）
    isReasoningDefault?: boolean; // 是否默认开启推理（DeepAI）
    // 视觉模型支持
    supportsVision?: boolean;    // 是否支持图像输入
    // 默认参数
    defaultTemperature?: number;
    defaultTopP?: number;
    defaultPresencePenalty?: number;
    defaultFrequencyPenalty?: number;
    defaultMaxTokens?: number;
    defaultReasoningEffort?: AIReasoningEffort;
    reasoningEffortFormat?: AIReasoningEffortFormat;
    customParameters?: Record<string, unknown> | null;
    // 访问控制（从数据库获取）
    requiredTier?: 'free' | 'plus' | 'pro';  // 基础访问所需等级
    reasoningRequiredTier?: 'free' | 'plus' | 'pro';  // 推理模式所需等级
    // 来源信息（用于统计）
    sourceKey?: string;  // 当前活跃来源 key
    transport?: AITransport; // 来源传输协议
    sources?: AIModelSourceConfig[]; // 非空来源清单为权威配置，可含禁用项；空清单兼容旧顶层配置
}

/** 自定义Provider (BYOK) 请求配置 */
export interface CustomProviderRequest {
    apiUrl: string;
    apiKey: string;
    modelId: string;
}

/** 自定义Provider (BYOK) 客户端配置 */
export interface CustomProviderConfig extends CustomProviderRequest {
    providerKey?: AIVendor | 'other';
    providerLabel?: string;
    modelName?: string;
}

// ===== 每日运势相关类型 =====

/** 运势等级 */
export type FortuneLevel = '大吉' | '吉' | '中吉' | '平' | '小凶' | '凶';

// ===== 用户相关类型 =====

// ===== Dify 增强功能相关类型 =====

/** Dify 增强模式 */
export type DifyMode = 'file' | 'web' | 'all';

/** 附件选择状态（前端使用） */
export interface AttachmentState {
    file?: File;
    webSearchEnabled: boolean;
}

/** Dify API 响应数据 */
export interface DifyResponse {
    web_content?: string;
    file_content?: string;
}

/** Dify 增强上下文（传递给 Chat API） */
export interface DifyContext {
    webContent?: string;
    fileContent?: string;
}
