import 'server-only';
import { findAnalysisMethod, listAnalysisMethods, renderMethodGuide } from 'taibu-core/mcp';

/** The trusted, versioned catalogue: one card per system or school, with the Core tools its system reads. */
export const ANALYSIS_METHODS = listAnalysisMethods();

/** A card by its id or by one of its system's tools; it never grants tools, web access or membership. */
export function loadAnalysisMethod(id: string, version?: string) {
    const method = findAnalysisMethod(id);
    if (!method || (version && method.version !== version)) throw new Error('分析方法或版本不存在');
    return { ...method, whenToUse: method.description, instructions: renderMethodGuide(method.id) + '\n计算必须调用 Core 工具；方法包不授予工具、联网或会员权限。' };
}
