/** Browser-safe vendor labels; no environment, SDK or React dependencies. */
export const VENDOR_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  glm: 'GLM',
  gemini: 'Gemini',
  qwen: 'Qwen',
  moonshot: 'Moonshot',
  xai: 'xAI',
  minimax: 'MiniMax',
};

export function getVendorName(vendor: string): string {
  return VENDOR_NAMES[vendor] ?? vendor;
}

/** 管理后台 vendor 下拉预设（从 VENDOR_NAMES 派生） */
export const VENDOR_PRESETS = Object.keys(VENDOR_NAMES) as readonly string[];
