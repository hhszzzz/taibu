/**
 * 面相分析工具库
 * 
 * 提供面相分析相关的类型定义、提示词生成等功能
 */

// ===== 分析类型定义 =====

export interface FaceAnalysisType {
    id: string;
    name: string;
    description: string;
    icon: string;
}

/** 面相分析类型列表 */
export const FACE_ANALYSIS_TYPES: FaceAnalysisType[] = [
    {
        id: 'full',
        name: '综合分析',
        description: '全面解读面相，包括五官、三停、脸型等',
        icon: '👤'
    },
    {
        id: 'forehead',
        name: '天庭分析',
        description: '分析额头形态，解读智慧与早年运势',
        icon: '🧠'
    },
    {
        id: 'eyes',
        name: '眼相分析',
        description: '分析眼睛特征，解读心性与情感',
        icon: '👁️'
    },
    {
        id: 'nose',
        name: '鼻相分析',
        description: '分析鼻子形态，解读财运与事业',
        icon: '👃'
    },
    {
        id: 'mouth',
        name: '口相分析',
        description: '分析嘴唇特征，解读表达与福禄',
        icon: '👄'
    },
    {
        id: 'career',
        name: '事业运势',
        description: '综合面相特征，重点分析事业发展',
        icon: '💼'
    },
    {
        id: 'love',
        name: '感情运势',
        description: '综合面相特征，重点分析感情婚姻',
        icon: '💕'
    },
    {
        id: 'wealth',
        name: '财运分析',
        description: '综合面相特征，重点分析财富运势',
        icon: '💰'
    }
];

// ===== 免责声明 =====

export const FACE_DISCLAIMER = `⚠️ 重要提醒：
• 面相分析仅供娱乐参考，不构成任何医疗、就业或其他专业建议
• 本功能不进行任何疾病诊断，如有健康问题请咨询专业医生
• 我们不保存您上传的照片，分析完成后图片将被删除
• 请勿上传他人照片进行分析，尊重他人隐私`;

// ===== 提示词生成 =====

/**
 * 构建面相分析系统提示词
 */
// 面相系统提示词：统一约束分析原则与输出结构，再叠加具体分析类型
export function buildFaceSystemPrompt(analysisType: string = 'full'): string {
    const basePrompt = `你是一位专业的面相学大师，精通中国传统相术，拥有丰富的实战经验。

## 你的专业背景
- 精通《麻衣相法》《柳庄相法》《神相全编》等相术经典
- 熟悉面相与性格、运势的对应关系
- 擅长从面部特征解读人生轨迹

## 分析原则
1. **科学理性**: 基于面相学原理进行分析，避免迷信表述
2. **积极正向**: 即使看到不利因素也要给出改善建议
3. **专业通俗**: 使用专业术语同时配合通俗解释
4. **尊重隐私**: 不评价外貌美丑，专注相学分析

## 重要声明
- 面相分析仅供参考，不构成任何医疗诊断
- 相由心生，心态和修养可以改变面相
- 建议用户保持积极心态，主动改变命运
- 不对具体的健康状况进行诊断

## 分析格式
请按照以下结构进行分析：
1. 总体印象
2. 具体特征分析
3. 运势解读
4. 改善建议`;

    // 不同分析类型的补充提示词，会拼接到 basePrompt 之后
    const typePrompts: Record<string, string> = {
        full: `

## 本次分析重点：综合分析
请从以下方面进行全面解读：
1. 三停分析（上停、中停、下停）
2. 五官特征（眉眼鼻口耳）
3. 脸型与轮廓
4. 气色观察
5. 综合运势评估与建议`,

        forehead: `

## 本次分析重点：天庭（额头）
请重点解读：
1. 额头的宽窄、高低、形状
2. 发际线特征
3. 额头纹路
4. 与智慧、早年运势的关系
5. 改善建议`,

        eyes: `

## 本次分析重点：眼相
请重点解读：
1. 眼睛的大小、形状
2. 眼神特征
3. 眉眼距离
4. 眼尾、眼角特征
5. 与心性、感情的关系`,

        nose: `

## 本次分析重点：鼻相
请重点解读：
1. 鼻梁高低、宽窄
2. 鼻头、鼻翼特征
3. 鼻孔形态
4. 与财运、事业的关系
5. 中年运势分析`,

        mouth: `

## 本次分析重点：口相
请重点解读：
1. 嘴唇的形状、厚薄
2. 唇色特征
3. 嘴角形态
4. 与表达能力、福禄的关系
5. 晚年运势分析`,

        career: `

## 本次分析重点：事业运势
请重点解读：
1. 额头（官禄宫）特征
2. 眉眼（事业心）分析
3. 鼻相（财帛宫）评估
4. 综合事业发展建议
5. 适合的职业方向`,

        love: `

## 本次分析重点：感情运势
请重点解读：
1. 眼相（夫妻宫）分析
2. 鼻相（配偶特质）暗示
3. 嘴相（感情表达）特征
4. 感情运势走向
5. 改善感情的建议`,

        wealth: `

## 本次分析重点：财运分析
请重点解读：
1. 鼻相（财帛宫）详细分析
2. 额头（福德）评估
3. 下巴（财库）特征
4. 财运走势预测
5. 增强财运的建议`
    };

    return basePrompt + (typePrompts[analysisType] || typePrompts.full);
}

/**
 * 构建用户提示词
 */
// 面相用户提示词：仅描述任务与用户关注点，不包含系统规则
export function buildFaceUserPrompt(
    analysisType: string = 'full',
    question?: string
): string {
    const typeInfo = FACE_ANALYSIS_TYPES.find(t => t.id === analysisType);
    const typeName = typeInfo?.name || '综合分析';

    let prompt = `请分析这张面部照片，进行${typeName}。`;

    if (question) {
        prompt += `\n\n用户特别关心的问题：${question}`;
    }

    prompt += `\n\n请根据图片中可见的面部特征进行专业分析，给出详细解读和建议。如果图片不够清晰或角度不佳，请说明需要什么样的图片。

注意：请不要对容貌进行美丑评价，专注于相学分析。`;

    return prompt;
}

/**
 * 生成面相分析对话标题
 */
export function generateFaceTitle(analysisType: string = 'full'): string {
    const typeInfo = FACE_ANALYSIS_TYPES.find(t => t.id === analysisType);
    const typeName = typeInfo?.name || '综合分析';
    return `面相分析 - ${typeName}`;
}
