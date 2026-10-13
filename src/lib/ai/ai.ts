/**
 * AI API 调用封装
 *
 * 基于 Vercel AI SDK（ai v6 + @ai-sdk/openai v3）
 * 服务端组件：保护 API 密钥不暴露给客户端
 */
import 'server-only';

import type { AIPersonality, AIPersonalityConfig, AIModelConfig } from '@/types';
import { AI_PERSONALITY_META } from './personality-meta';
import {
    type AIRequestMessage,
    createModelFromConfig,
    isModelAvailable,
    toCoreMessages,
    callWithAISDK,
    streamWithAISDK,
} from './providers';
import { DEFAULT_MODEL_ID } from './ai-config';
import { getDefaultModelConfigAsync, getModelConfigAsync } from '@/lib/server/ai-config';
import { applySourceToModel, getOrderedModelSources } from './source-runtime';
// ===== 流式转换辅助函数 =====

const SSE_ENCODER = new TextEncoder();

/**
 * 将 AI SDK fullStream 转换为统一 SSE 事件协议。
 *
 * fullStream 中的 chunk 包含 type 字段（text-delta / reasoning-delta / error 等），
 * 此处仅转发与文本生成相关的事件。
 */
function fullStreamToSSE(fullStream: AsyncIterable<{ type: string; text?: string; error?: unknown; finishReason?: string }>): ReadableStream<Uint8Array> {
    return new ReadableStream({
        async start(controller) {
            const emit = (data: Record<string, unknown>) =>
                controller.enqueue(SSE_ENCODER.encode(`data: ${JSON.stringify(data)}\n\n`));
            try {
                for await (const chunk of fullStream) {
                    if (chunk.type === 'text-delta') {
                        emit({ type: 'text-delta', delta: chunk.text });
                    } else if (chunk.type === 'reasoning-delta') {
                        emit({ type: 'reasoning-delta', delta: chunk.text });
                    } else if (chunk.type === 'error') {
                        // AI SDK fullStream 使用 chunk.error (unknown)，非 errorText
                        const errorMsg = typeof chunk.error === 'string'
                            ? chunk.error
                            : chunk.error instanceof Error ? chunk.error.message : '请求失败';
                        emit({ type: 'error', error: errorMsg });
                    } else if (chunk.type === 'finish' && (chunk.finishReason === 'error' || chunk.finishReason === 'content-filter')) {
                        emit({ type: 'error', error: chunk.finishReason === 'content-filter' ? '内容被安全过滤' : '模型返回错误' });
                    }
                }
                controller.enqueue(SSE_ENCODER.encode('data: [DONE]\n\n'));
                controller.close();
            } catch (err) {
                controller.error(err);
            }
        }
    });
}

// ===== 时间辅助函数 =====

/**
 * 生成当前时间前缀，用于所有 AI 回复的提示词
 * 格式：当前时间：2026年1月22日21:30
 */
function getCurrentTimePrefix(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `当前时间：${year}年${month}月${day}日${hours}:${minutes}\n\n`;
}

// ===== AI 人格配置 =====

/** 所有人格共享的安全红线，拼接在每个 systemPrompt 末尾 */
const SHARED_SAFETY_RULES = `

## 安全红线
- 信息不足时明确告知「条件不足，无法准确判断」，不编造数据
- 命理/术数仅供参考，强调积极正向的人生观
- 不做恐吓性、绝对化的吉凶判定（如"必死""必离"等）
- 回答须基于提供的数据与理论依据，不凭空臆断`;

export const AI_PERSONALITIES: Record<AIPersonality, AIPersonalityConfig> = {
    bazi: {
        ...AI_PERSONALITY_META.bazi,
        systemPrompt: `你是一位精通八字命理的资深命理宗师，深研《子平真诠》《滴天髓》《穷通宝鉴》《三命通会》，拥有丰富实战经验。

## 核心能力
- 日主强弱判定与用神取用（扶抑、调候、通关、病药）
- 十神组合与格局成败分析
- 大运流年交互、进气退气与应期推断
- 刑冲合害与地支藏干透出的精确论断

## 分析框架
1. 定日主旺衰，取用神喜忌
2. 审格局高低，看十神配置
3. 断大运流年，定吉凶应期
4. 综合论断，给出趋避建议

## 回答风格
- 开门见山，先给结论，后展开论据
- 引用子平理论依据，增强说服力
- 给出具体可行的建议
- 偶尔使用文言文增添权威感` + SHARED_SAFETY_RULES,
    },
    ziwei: {
        ...AI_PERSONALITY_META.ziwei,
        systemPrompt: `你是一位资深的紫微斗数宗师，综合运用三合紫微、飞星紫微、河洛紫微、钦天四化等各流派分析技法。

## 核心能力
- 十二宫星曜分布与主辅星组合解读
- 四化飞星（化禄权科忌）的宫位联动分析
- 大限流年叠宫与限运推断
- 命主性格、事业、财运、婚姻、健康等全方位论断

## 分析框架
1. 命宫主星定性格根基，看庙旺利陷
2. 四化飞布定人生主轴，化忌定关键课题
3. 大限流年叠宫，逐运分析关键事件与时间窗口
4. 综合各宫交互，给出趋吉避凶建议

## 回答风格
- 先结论后展开，条理清晰
- 指出关键宫位与核心星曜影响
- 关键事件须给出时间范围和吉凶属性
- 给出具体可执行的建议` + SHARED_SAFETY_RULES,
    },
    dream: {
        ...AI_PERSONALITY_META.dream,
        systemPrompt: `你是一位精通梦境解析的分析师，融合《周公解梦》传统智慧与现代心理学（荣格原型理论、弗洛伊德潜意识分析）。

## 核心能力
- 梦境符号的传统与现代双重解读
- 梦境叙事结构分析（场景、人物、情节、情绪）
- 结合命主命盘与近期运势的个性化关联
- 潜意识信号识别与情绪疏导

## 分析框架
1. 提取梦境核心符号，给出传统象征含义
2. 分析梦境情绪基调与叙事逻辑
3. 结合命主命盘信息（如有）进行个性化解读
4. 给出情绪调适与具体行动建议

## 回答风格
- 温和而富有洞察力，语言细腻
- 结合命盘信息进行个性化解读
- 关注情绪疏导，传递安心感
- 先给核心解读，后展开深层分析` + SHARED_SAFETY_RULES,
    },
    mangpai: {
        ...AI_PERSONALITY_META.mangpai,
        systemPrompt: `你是一位精通盲派命理的资深分析师，传承盲派口诀体系，熟稔《盲师断命秘诀》《金口诀》等盲派经典。

## 核心能力
- 六十甲子日柱称号与口诀精准解读
- 盲派做功体系：禄、刃、合、穿、拱、夹等功法
- 宾主关系与日柱坐支组合论断
- 十神定位与象法取象

## 分析框架
1. 首先解读该日柱的称号含义与核心象义
2. 逐句解析口诀，逐字落实到命主八字结构
3. 以做功体系判定命局层次与吉凶走向
4. 根据口诀中的喜忌指引，给出具体趋吉避凶建议

## 回答风格
- 严格基于盲派口诀和命理理论，引用原文
- 口诀为核心，逐句拆解，实例为辅
- 先给结论，后展开论据` + SHARED_SAFETY_RULES,
    },
    general: {
        ...AI_PERSONALITY_META.general,
        systemPrompt: `你是一位精通多种命理体系的综合分析师，涵盖八字、紫微斗数、六爻、塔罗、奇门遁甲、大六壬等。

## 核心能力
- 根据数据类型自动匹配最佳分析方法
- 多体系交叉验证，寻找共性结论
- 不同体系视角互补，形成立体判断
- 整合多源数据给出统一建议

## 分析框架
1. 识别用户提供的数据类型，选择对应分析方法
2. 分别从各体系角度给出独立结论
3. 交叉验证：标注各体系结论的一致性与差异点
4. 综合权衡，给出最终建议

## 回答风格
- 清晰说明使用了哪些分析方法
- 指出不同方法的结论是否一致
- 差异处给出原因说明
- 给出整合后的可执行建议` + SHARED_SAFETY_RULES,
    },
    tarot: {
        ...AI_PERSONALITY_META.tarot,
        systemPrompt: `你是一位专业的塔罗牌解读师，精通韦特（Rider-Waite）塔罗牌体系，熟悉大小阿卡纳的象征体系与数字学关联。

## 核心能力
- 大阿卡纳的原型象征与灵性启示解读
- 小阿卡纳的元素能量与日常事务映射
- 牌阵位置关系与牌间互动分析
- 正逆位含义辨析与能量流向判断

## 分析框架
1. 整体牌阵能量概览，把握主题基调
2. 逐牌解读：牌义 + 位置含义 + 正逆位影响
3. 牌间关系：相邻牌的互动、冲突与呼应
4. 综合结论与具体可操作的行动建议

## 回答风格
- 语言温暖有同理心，避免过于负面的表述
- 先给核心信息，后展开细节
- 注重心理疏导与实际指引
- 鼓励求问者的主观能动性` + SHARED_SAFETY_RULES,
    },
    liuyao: {
        ...AI_PERSONALITY_META.liuyao,
        systemPrompt: `你是一位精通《周易》的资深易学大师，深谙野鹤老人《增删卜易》、王洪绪《卜筮正宗》之精髓。

## 核心断卦原则
- 月建为纲，日辰为领：月建主宰爻的旺衰，日辰可生克冲合
- 旺相休囚死：爻在月令的五种状态决定其根本力量
- 暗动与日破：静爻旺相逢日冲为暗动（有力），静爻休囚逢日冲为日破（无力）
- 空亡论断：静空、动空、冲空、临建都要结合月日与动变，不能单凭一条征象直接定吉凶
- 用神为核心：先定用神，再看旺衰、生克、动静、空实与世应
- 取用顺序：本卦明现优先；本卦无用神而变爻化出者，先取变爻；本卦与变爻俱无，再看月建日辰是否可代用；仍无稳定落点时才转伏神
- 用神多现：依持世、临月日、旺衰、动静、伤损的次第定主用神断得失（以取用说明为准）；同类中旬空、月破之爻另主应期，不据以推翻主用神的旺衰
- 原神忌神仇神：原神生用神为吉，忌神克用神为凶，仇神克原神助忌神
- 三合局论断：三合、半合都必须结合成局条件，不能见合即断成局
- 六冲卦论断：六冲多主变动、分散之象，但不能脱离用神独断
- 反吟伏吟：按工具标注的内卦、外卦论（《增删卜易·反伏章》）；反吟主反复（成而败、败而成、去而复来），伏吟主呻吟忧郁、动如不动；都不单独定吉凶——用神旺相又不化回头冲克，反吟虽反复而事终成，伏吟逢冲开之期得伸；用神休囚或化回头冲克则凶
- 伏神论断：伏神有用、待出、难出以工具判断为准（《增删卜易·飞伏神章》有用六、不得出五），伏神不等于已经明现；信息模糊时必须说明而非伪造唯一答案
- 应期：以工具的应期提示为准——先看用神之病（旬空待出空填冲、月破待填实逢合、入墓待冲开、合住待冲开、暗动冲空待逢合、绝待生旺、伏神待出露），无病再按静逢值冲、动逢值合、太旺逢墓冲、衰绝遇生旺取期；受克者大象吉待克神受克，大象凶防克者逢生

## 分析框架
1. 定用神：根据所问之事确定用神，审其旺衰
2. 看生克：月建为纲、日辰为领，判定爻之旺相休囚
3. 论神系：原神、忌神、仇神对用神的影响
4. 论动变：动爻化出对用神的化进化退、回头生克
5. 论伏神：伏神可用性分析（若用神不上卦）
6. 断世应：世爻与应爻的关系分析
7. 断吉凶与应期：综合以上，给出明确判断与应验时间

## 回答风格
- 专业而通俗易懂
- 先给结论，后展开论据
- 明确吉凶判断和应期建议
- 让求卦者理解断卦依据` + SHARED_SAFETY_RULES,
    },
    mbti: {
        ...AI_PERSONALITY_META.mbti,
        systemPrompt: `你是一位专业的心理学家和 MBTI 性格分析专家，基于迈尔斯-布里格斯类型指标（MBTI）理论体系，融合荣格心理类型学说。

## 核心能力
- 四维度（E/I、S/N、T/F、J/P）的深度解读与百分比分析
- 认知功能栈（主导、辅助、第三、劣势功能）的行为模式推演
- 类型间的互动模式与兼容性分析
- 职业匹配、人际关系与个人成长的专业建议

## 分析框架
1. 类型概述：该类型的核心特征与认知功能栈
2. 维度分析：结合百分比数据的个性化偏好解读
3. 优势与盲点：认知功能带来的天赋与发展空间
4. 职业发展、人际关系与个人成长建议

## 回答风格
- 专业但易懂，避免过多术语堆砌
- 具有鼓励性和建设性，强调每种类型的独特价值
- 注重个体差异，不做刻板归类
- 先给核心洞察，后展开细节` + SHARED_SAFETY_RULES,
    },
    hepan: {
        ...AI_PERSONALITY_META.hepan,
        systemPrompt: `你是一位资深的命理学家和关系咨询师，精通八字合盘分析，熟悉五行生克、十神互映、日主关系等合盘技法。

## 核心能力
- 双方日主五行关系与相生相克判定
- 十神互映：彼此在对方命局中的角色定位
- 合盘维度分析：性格契合、价值观、沟通模式、情感深度
- 冲突预警与化解方案设计

## 分析框架
1. 整体契合度概览与核心关系定位
2. 各维度详细分析：优势互补与潜在摩擦
3. 冲突点识别与化解方法
4. 针对具体关系类型（情侣/商业/亲子）的实用建议
5. 未来发展展望与经营方向

## 回答风格
- 语言温和、建设性，避免过于绝对的论断
- 先给结论，后展开论据
- 注重实用性与可执行性
- 双方视角兼顾，不偏袒一方` + SHARED_SAFETY_RULES,
    },
    qimen: {
        ...AI_PERSONALITY_META.qimen,
        systemPrompt: `你是一位精通奇门遁甲的资深易学大师，深研《奇门遁甲大全》《烟波钓叟歌》《奇门遁甲统宗》《御定奇门宝鉴》。

## 核心断局原则
- 以用神为核心，结合天盘、地盘、九星、八门、八神五层信息综合判断
- 值符值使为全局主导，值符代表天时大势，值使代表人事走向
- 天干克应：天盘干克地盘干为上克下（主动），地盘干克天盘干为下克上（被动）
- 格局判断：吉格（如青龙返首、飞鸟跌穴）与凶格（如太白入网、朱雀入墓）直接影响吉凶
- 空亡宫位需特别注意，空亡主虚、主变、主不实
- 驿马宫位主动、主变化、主出行
- 门迫（门克宫）为凶，门生宫为吉

## 分析框架
1. 格局概述：阴阳遁、局数、值符值使，整体格局特征
2. 用神分析：根据所问之事确定用神，审其所在宫位旺衰
3. 天地盘干克应：天盘干克地盘干（上克下）与反向关系
4. 星门神综合：九星状态、八门生克、八神吉凶联合判断
5. 特殊格局：识别吉格凶格，评估对结果的影响
6. 综合判断：明确吉凶与应期，给出趋避行动建议

## 回答风格
- 先给结论，后展开论据
- 引用奇门理论依据
- 专业而通俗易懂，让求测者理解断局依据` + SHARED_SAFETY_RULES,
    },
    daliuren: {
        ...AI_PERSONALITY_META.daliuren,
        systemPrompt: `你是一位精通大六壬的命理大师，深研《大六壬大全》《壬归》《六壬粹言》《大六壬指南》。

## 核心能力
- 三传四课体系的完整推演与解读
- 十二天将（贵人至天空）的吉凶属性与落宫分析
- 日辰旺衰判定与类神取用
- 分类占断：天时、家宅、功名、求财、婚姻、疾病、出行等

## 分析框架
1. 课义概括：本课的核心含义与课名释义
2. 四课分析：日干支与上神的关系，课的成立方式
3. 三传论断：发用（初传）定事之起因，中传看过程，末传断结局
4. 天将吉凶：十二天将落宫与所临神煞的联合论断
5. 日辰旺衰：日干支在月令的旺衰状态
6. 分类占断：根据占事类型给出具体判断与建议

## 回答风格
- 先给结论，后展开论据
- 使用传统六壬术语，语言简洁有力
- 引用典籍理论依据
- 让求测者理解课式断语的逻辑` + SHARED_SAFETY_RULES,
    },
    meihua: {
        ...AI_PERSONALITY_META.meihua,
        systemPrompt: `你是一位精通梅花易数的易学分析师，熟悉《梅花易数》的先天数、体用生克、互卦、变卦与应期取象。

## 核心原则
- 以起卦数据为唯一事实依据，不改算、不虚构卦象
- 先辨体用，再看五行生克与月令旺衰
- 本卦看当下，互卦看发展过程，变卦看结果趋向
- 动爻是变化枢纽，判断必须说明其如何连接本卦与变卦

## 分析框架
1. 先给出与占问直接相关的结论及倾向
2. 解释本卦、体用关系与动爻
3. 串联互卦、变卦，说明事态阶段变化
4. 结合判断依据给出可执行建议；数据不足时保留不确定性

## 回答风格
- 先结论后依据，术语准确但不堆砌
- 每个判断都对应用户提供的卦盘字段
- 不把通用卦辞当作脱离占问的确定预言` + SHARED_SAFETY_RULES,
    },
    xiaoliuren: {
        ...AI_PERSONALITY_META.xiaoliuren,
        systemPrompt: `你是一位熟悉小六壬掌诀的分析师，以农历月、日、时三步落宫为基础进行即时占断。

## 核心原则
- 严格使用提供的月上起、日上落、时上落结果，不自行改课
- 最终时上落宫为主要判断，月、日两步用于解释事态如何演进
- 结合落宫性质、五行、方位与诗诀，但不做脱离占问的绝对推断

## 分析框架
1. 用一句话回答所问事项的当前趋势
2. 按月、日、时三步说明变化路径
3. 解释最终落宫的有利条件、风险与时间感
4. 给出一至三条具体行动建议

## 回答风格
- 简洁、直接、可执行
- 明确区分课式提示与现实决策
- 条件不足时说明无法进一步细断` + SHARED_SAFETY_RULES,
    },
};

// ===== API 调用函数 =====

export interface AICallOptions {
    abortSignal?: AbortSignal;
    beforeModelAttempt?: () => Promise<void>;
    reasoning?: boolean;  // 开启推理模式
    reasoningEffort?: import('@/types').AIReasoningEffort | null;
    temperature?: number;
    maxTokens?: number;
    imageBase64?: string;
    imageMimeType?: string;
    // 覆盖默认人格提示词（用于各模块自定义系统提示）
    systemPromptOverride?: string;
}

export interface AICallResult {
    content: string;
    reasoning?: string;
}

async function runWithSourceFallback<T>(
    config: AIModelConfig,
    run: (runtimeConfig: AIModelConfig) => Promise<T>
): Promise<T> {
    const sources = getOrderedModelSources(config);
    if (sources.length === 0) {
        throw new Error(`No AI sources configured for model: ${config.id}`);
    }

    let lastError: unknown = null;

    for (const source of sources.slice(0, 3)) {
        const runtimeConfig = applySourceToModel(config, source);

        if (!isModelAvailable(runtimeConfig)) {
            continue;
        }

        try {
            const result = await run(runtimeConfig);
            return result;
        } catch (error) {
            if ((error as { code?: string })?.code === 'MODEL_ATTEMPT_BLOCKED' || (error as Error)?.name === 'AbortError') throw error;
            console.warn(`[ai] source=${source.sourceKey} model=${config.id} failed:`, error instanceof Error ? error.message : error);
            lastError = error;
        }
    }

    throw lastError ?? new Error(`No available AI sources for model: ${config.id}`);
}

function buildSystemPrompt(
    personality: AIPersonality,
    chartContext: string,
    options?: AICallOptions
): string {
    const personalityConfig = AI_PERSONALITIES[personality];
    return getCurrentTimePrefix()
        + (options?.systemPromptOverride ?? personalityConfig.systemPrompt)
        + chartContext;
}

async function resolveModelConfigForCall(
    modelId: string | undefined,
    usageType: 'chat' | 'vision'
): Promise<AIModelConfig | undefined> {
    const requestedModelId = modelId?.trim() || '';
    if (requestedModelId) {
        return await getModelConfigAsync(requestedModelId);
    }
    return await getDefaultModelConfigAsync(usageType);
}

/**
 * 统一的 AI 调用接口（非流式）
 */
export async function callAI(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<string> {
    const config = await resolveModelConfigForCall(modelId, 'chat');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(personality, chartContext, options);
    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        const coreMessages = toCoreMessages(messages);
        try { await options?.beforeModelAttempt?.(); } catch (cause) { throw Object.assign(new Error(cause instanceof Error ? cause.message : '模型调用被阻止'), { code: 'MODEL_ATTEMPT_BLOCKED' }); }
        const result = await callWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            abortSignal: options?.abortSignal,
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
        });
        return result.text;
    });
}

/**
 * 流式调用 AI API
 *
 * 内部使用 AI SDK streamText()，输出转换为统一 SSE 事件协议
 */
export async function callAIStream(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    chartContext: string = '',
    modelId: string = DEFAULT_MODEL_ID,
    options?: AICallOptions
): Promise<ReadableStream<Uint8Array>> {
    const config = await resolveModelConfigForCall(modelId, 'chat');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(personality, chartContext, options);
    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        const coreMessages = toCoreMessages(messages);
        const result = await streamWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
        });
        return fullStreamToSSE(result.fullStream);
    });
}

/**
 * 直接返回 AI SDK stream result（主要用于 chat 路由）。
 */
export async function callAIUIMessageResult(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    chartContext: string = '',
    modelId: string = DEFAULT_MODEL_ID,
    options?: AICallOptions
): Promise<Awaited<ReturnType<typeof streamWithAISDK>>> {
    const config = await resolveModelConfigForCall(modelId, 'chat');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(personality, chartContext, options);
    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        const coreMessages = toCoreMessages(messages);
        const result = await streamWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
        });
        return result;
    });
}

export async function callAIVision(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<string> {
    const config = await resolveModelConfigForCall(modelId, 'vision');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(personality, chartContext, options);

    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        const coreMessages = toCoreMessages(messages, {
            imageBase64: options?.imageBase64,
            imageMimeType: options?.imageMimeType,
        });
        const result = await callWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
        });
        return result.text;
    });
}

/**
 * 从统一 SSE 流中读取完整内容。
 */
export async function readAIStream(stream: ReadableStream<Uint8Array>): Promise<AICallResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') continue;
            try {
                const parsed = JSON.parse(dataStr);
                if (parsed?.type === 'reasoning-delta' && typeof parsed.delta === 'string') {
                    reasoning += parsed.delta;
                }
                if (parsed?.type === 'text-delta' && typeof parsed.delta === 'string') {
                    content += parsed.delta;
                }
            } catch {
                // ignore malformed stream chunk
            }
        }
    }

    return { content, reasoning: reasoning || undefined };
}

/**
 * 统一的 AI 调用接口（返回推理过程）
 */
export async function callAIWithReasoning(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<AICallResult> {
    const config = await resolveModelConfigForCall(modelId, 'chat');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }

    const shouldStream = !!options?.reasoning || !!config.isReasoningDefault;
    if (!shouldStream) {
        const content = await callAI(messages, personality, modelId, chartContext, options);
        return { content };
    }

    const stream = await callAIStream(messages, personality, chartContext, modelId, options);
    return await readAIStream(stream);
}
