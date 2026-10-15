export const CUSTOM_PROVIDER_MAX_API_URL_LENGTH = 256;
export const CUSTOM_PROVIDER_MAX_API_KEY_LENGTH = 512;
export const CUSTOM_PROVIDER_MAX_MODEL_ID_LENGTH = 128;

export interface CustomProviderInputErrors {
    apiUrl?: string;
    apiKey?: string;
    modelId?: string;
}

/**
 * 标准化 OpenAI 兼容网关 base URL。
 *
 * - 自动去掉尾部斜杠
 * - 如果用户传入完整 `/chat/completions`，回退到 baseURL
 * - 如果缺少 `/v1` 版本段，则自动补齐
 */
export function normalizeCustomProviderBaseUrl(apiUrl: string): string {
    const parsed = new URL(apiUrl.trim());
    parsed.search = '';
    parsed.hash = '';

    let pathname = parsed.pathname.replace(/\/+$/u, '');

    if (pathname.endsWith('/v1/chat/completions')) {
        pathname = pathname.replace(/\/v1\/chat\/completions$/u, '/v1');
    } else if (pathname.endsWith('/chat/completions')) {
        pathname = pathname.replace(/\/chat\/completions$/u, '');
    }

    if (!/\/v\d+$/u.test(pathname)) {
        pathname = `${pathname || ''}/v1`;
    }

    parsed.pathname = pathname;
    return parsed.toString().replace(/\/$/u, '');
}

export function buildCustomProviderChatCompletionsUrl(apiUrl: string): string {
    return `${normalizeCustomProviderBaseUrl(apiUrl)}/chat/completions`;
}

export function validateCustomProviderInput(config: {
    apiUrl: string;
    apiKey: string;
    modelId: string;
}): CustomProviderInputErrors {
    const errors: CustomProviderInputErrors = {};
    const apiUrl = config.apiUrl.trim();
    const apiKey = config.apiKey.trim();
    const modelId = config.modelId.trim();

    if (!apiUrl) {
        errors.apiUrl = '请输入 API URL';
    } else if (apiUrl.length > CUSTOM_PROVIDER_MAX_API_URL_LENGTH) {
        errors.apiUrl = 'API URL 过长';
    } else {
        try {
            const parsed = new URL(apiUrl);
            if (!parsed.hostname) {
                errors.apiUrl = 'API URL 格式无效';
            } else if (parsed.protocol !== 'https:') {
                errors.apiUrl = '仅支持 HTTPS 地址';
            } else if (parsed.username || parsed.password) {
                errors.apiUrl = 'API URL 不应包含认证信息';
            } else if (parsed.search || parsed.hash) {
                errors.apiUrl = 'API URL 不应包含查询参数或片段';
            }
        } catch {
            errors.apiUrl = 'API URL 格式无效';
        }
    }

    if (!apiKey) {
        errors.apiKey = '请输入 API Key';
    } else if (apiKey.length > CUSTOM_PROVIDER_MAX_API_KEY_LENGTH) {
        errors.apiKey = 'API Key 过长';
    }

    if (!modelId) {
        errors.modelId = '请输入 Model ID';
    } else if (modelId.length > CUSTOM_PROVIDER_MAX_MODEL_ID_LENGTH) {
        errors.modelId = 'Model ID 过长';
    }

    return errors;
}

/** 展示用的 Key 掩码：只露出前 3 位和后 4 位，过短的 Key 完全遮住。 */
export function maskCustomProviderApiKey(apiKey: string | null | undefined): string {
  const secret = apiKey?.trim() ?? '';
  if (secret.length <= 10) return '••••••••';
  return `${secret.slice(0, 3)}••••••••${secret.slice(-4)}`;
}
