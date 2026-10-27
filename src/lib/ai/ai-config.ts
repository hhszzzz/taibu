/**
 * AI 模型配置
 *
 * 模型目录、网关地址与密钥都由数据库维护（设置中心「AI 服务」），这里只提供默认模型 ID 与供应商名称。
 */

export const DEFAULT_MODEL_ID = '';
export const DEFAULT_VISION_MODEL_ID = '';
export const DEFAULT_EMBEDDING_MODEL_ID = process.env.KNOWLEDGE_BASE_EMBEDDING_MODEL_ID || 'text-embedding-v4';
export const DEFAULT_RERANK_MODEL_ID = process.env.KNOWLEDGE_BASE_RERANK_MODEL_ID || 'qwen3-rerank';

export { VENDOR_NAMES, getVendorName, VENDOR_PRESETS } from './vendor-labels';
