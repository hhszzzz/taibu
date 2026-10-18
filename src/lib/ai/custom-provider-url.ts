export const CUSTOM_PROVIDER_MAX_API_URL_LENGTH = 256;
export const CUSTOM_PROVIDER_MAX_API_KEY_LENGTH = 512;
export const CUSTOM_PROVIDER_MAX_MODEL_ID_LENGTH = 128;
export const CUSTOM_PROVIDER_MAX_MODEL_NAME_LENGTH = 128;

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
 * - 路径中不含版本段（如 `/v1`、`/v4`、`/v1beta`）时自动补 `/v1`；
 *   自带版本段的网关（GLM `/api/paas/v4`、Gemini `/v1beta/openai`）保持原样
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

    if (!/\/v\d+/u.test(pathname)) {
        pathname = `${pathname || ''}/v1`;
    }

    parsed.pathname = pathname;
    return parsed.toString().replace(/\/$/u, '');
}

export function buildCustomProviderChatCompletionsUrl(apiUrl: string): string {
    return `${normalizeCustomProviderBaseUrl(apiUrl)}/chat/completions`;
}

/**
 * 用户是否手写了由系统补全的后缀（`/v1` 或 `/chat/completions`），用于提示。
 *
 * 只认这两种「其实不用写」的形态：GLM `/api/paas/v4`、Gemini `/v1beta/openai`
 * 这类网关自带版本段是必要路径，不算冗余（这也是该提示存在的意义）。
 */
export function hasRedundantVersionSuffix(apiUrl: string): boolean {
    try {
        const pathname = new URL(apiUrl.trim()).pathname.replace(/\/+$/u, '');
        return /\/v1$/iu.test(pathname) || /\/chat\/completions$/iu.test(pathname);
    } catch {
        return false;
    }
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
        errors.modelId = '请输入实际请求模型';
    } else if (modelId.length > CUSTOM_PROVIDER_MAX_MODEL_ID_LENGTH) {
        errors.modelId = '实际请求模型过长';
    }

    return errors;
}

/** 展示用的 Key 掩码：只露出前 3 位和后 4 位，过短的 Key 完全遮住。 */
export function maskCustomProviderApiKey(apiKey: string | null | undefined): string {
  const secret = apiKey?.trim() ?? '';
  if (secret.length <= 10) return '••••••••';
  return `${secret.slice(0, 3)}••••••••${secret.slice(-4)}`;
}
