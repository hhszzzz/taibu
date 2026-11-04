import type { AIMessageMetadata, AIModelPricing, ChatAttachment, ChatMessage } from '@/types';
import type { Mention } from '@/types/mentions';
import type { UserIdentityProfile } from '@/lib/user/settings';
import type { VisualizationSettings } from '@/lib/visualization/settings';

/** Validated chat input; authorization flags and credentials belong to the adapter. */
export interface ChatPreparationInput {
  messages: ChatMessage[];
  stream?: boolean;
  model?: string;
  reasoning?: boolean;
  reasoningEffort?: import('@/types').AIReasoningEffort | null;
  /** Text the server extracted from the document attached to the last user message. */
  attachment?: ChatAttachment;
  /** Search the web for the last user message before answering. */
  webSearch?: boolean;
  /** The browser's IANA time zone, which the last user message is dated in; China Standard Time when absent or unknown. */
  timezone?: string;
  mentions?: Mention[];
  expressionStyle?: 'direct' | 'gentle';
  customInstructions?: string | null;
  userProfile?: UserIdentityProfile | null;
  visualizationSettings?: VisualizationSettings;
}

/** Only an authenticated server adapter may grant trusted-bypass; everyone else pays for what the call uses. */
export type ChatActor =
  | { userId: string; billing: 'metered' }
  | { userId: string | null; billing: 'trusted-bypass' };

export interface ChatModelAccess {
  id: string;
  /** Priced by an administrator, so the platform offers it. */
  offered: boolean;
  pricing?: AIModelPricing;
  supportsReasoning: boolean;
}

export type ChatPreparationFailure = {
  kind: 'invalid-model' | 'model-unpriced' | 'insufficient-balance' | 'balance-unavailable' | 'rate-limited' | 'rate-limit-failed';
};

export type ChatPreparationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ChatPreparationFailure };

export interface ResolvedChatPreparation {
  input: ChatPreparationInput;
  userId: string | null;
  /** The member pays for this call's usage once it is known. */
  metered: boolean;
  requestedModelId: string;
  reasoningEnabled: boolean;
}

export interface ChatPromptContext {
  agentMemoryEnabled?: boolean;
  sanitizedMessages: ChatMessage[];
  metadata: AIMessageMetadata & {
    sources?: unknown;
    kbSearchEnabled: boolean;
    kbHitCount: number;
    promptDiagnostics: {
      modelId: string;
      layers: unknown;
      totalTokens: number;
      budgetTotal: number;
      userMessageTokens: number;
    };
  };
  systemPrompt: string;
  promptKnowledgeBases: Array<{ id: string; name: string }>;
}

export type PreparedChat = ResolvedChatPreparation & ChatPromptContext;

export interface ManagedChatResolutionOperations {
  defaultModelId: string;
  resolveModel(modelId: string): Promise<ChatModelAccess | null>;
  /** Whether the member has something to spend on this model; throws when the balance cannot be read. */
  admit(model: ChatModelAccess): Promise<boolean>;
  checkRateLimit(): Promise<boolean>;
}

export interface ManagedChatOperations extends ManagedChatResolutionOperations {
  buildPrompt(resolved: ResolvedChatPreparation): Promise<ChatPromptContext>;
}

export interface DirectChatOperations {
  defaultModelId: string;
  checkRateLimit(): Promise<boolean>;
  buildPrompt(resolved: ResolvedChatPreparation): Promise<ChatPromptContext>;
}
