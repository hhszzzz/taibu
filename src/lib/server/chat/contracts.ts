import type { AIMessageMetadata, AIPersonality, ChatMessage, DifyContext } from '@/types';
import type { Mention } from '@/types/mentions';
import type { MembershipType } from '@/lib/user/membership';
import type { UserIdentityProfile } from '@/lib/user/settings';
import type { VisualizationSettings } from '@/lib/visualization/settings';

/** Validated chat input; authorization flags and credentials belong to the adapter. */
export interface ChatPreparationInput {
  messages: ChatMessage[];
  stream?: boolean;
  mangpaiMode?: boolean;
  model?: string;
  reasoning?: boolean;
  difyContext?: DifyContext;
  mentions?: Mention[];
  dreamMode?: boolean;
  expressionStyle?: 'direct' | 'gentle';
  customInstructions?: string | null;
  userProfile?: UserIdentityProfile | null;
  visualizationSettings?: VisualizationSettings;
}

/** Only an authenticated server adapter may grant trusted-bypass. */
export type ChatActor =
  | { userId: string; creditPolicy: 'charge' }
  | { userId: string | null; creditPolicy: 'trusted-bypass' };

export interface ChatAccount {
  effectiveMembership: MembershipType;
  hasCredits: boolean;
}

export interface ChatModelAccess {
  id: string;
  allowedMemberships: MembershipType[];
  reasoningMemberships: MembershipType[];
}

export type ChatPreparationFailure =
  | { kind: 'invalid-model' | 'membership-denied' | 'insufficient-credits' | 'deduction-failed' | 'rate-limited' | 'rate-limit-failed' | 'rate-limit-refund-failed' }
  | { kind: 'account-unavailable'; message: string; code: string };

export type ChatPreparationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ChatPreparationFailure };

export interface ResolvedChatPreparation {
  input: ChatPreparationInput;
  userId: string | null;
  canSkipCredit: boolean;
  requestedModelId: string;
  membershipType: MembershipType;
  reasoningEnabled: boolean;
  creditDeducted: boolean;
}

export interface ChatPromptContext {
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
    dreamContext?: { baziChartName?: string; dailyFortune?: string };
  };
  fallbackPersonality: AIPersonality;
  systemPrompt: string;
  promptKnowledgeBases: Array<{ id: string; name: string }>;
}

export type PreparedChat = ResolvedChatPreparation & ChatPromptContext;

export interface ChatAccountOperations {
  loadAccount(): Promise<ChatPreparationResult<ChatAccount>>;
}

export interface ManagedChatResolutionOperations extends ChatAccountOperations {
  defaultModelId: string;
  resolveModel(modelId: string): Promise<ChatModelAccess | null>;
  deductCredit(): Promise<
    | { ok: true }
    | { ok: false; reason: 'insufficient_credits' | 'deduction_failed' }
  >;
  checkRateLimit(): Promise<boolean>;
  refundRateLimitFailure(): Promise<boolean>;
}

export interface ManagedChatOperations extends ManagedChatResolutionOperations {
  buildPrompt(resolved: ResolvedChatPreparation): Promise<ChatPromptContext>;
  refundPromptFailure(): Promise<void>;
}

export interface DirectChatOperations extends ChatAccountOperations {
  defaultModelId: string;
  checkRateLimit(): Promise<boolean>;
  buildPrompt(resolved: ResolvedChatPreparation): Promise<ChatPromptContext>;
}
