/**
 * MCP tool contract
 */
import { completeOutputSchema } from './output-schema-rules.js';

export interface ToolAnnotation {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export type ToolSchema = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  properties?: Record<string, ToolSchema>;
  items?: ToolSchema;
  required?: string[];
  examples?: unknown[];
  allOf?: ToolSchema[];
  anyOf?: ToolSchema[];
  oneOf?: ToolSchema[];
  not?: ToolSchema;
  if?: ToolSchema;
  then?: ToolSchema;
  else?: ToolSchema;
  enum?: unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  additionalProperties?: boolean;
  description?: string;
  default?: unknown;
};

export type ToolInputSchema = ToolSchema & {
  type: 'object';
  properties: Record<string, ToolSchema>;
};

export type ToolOutputSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: ToolAnnotation;
}

export type ListedToolDefinition = ToolDefinition & {
  title: string;
  outputSchema: ToolOutputSchema;
};

export type RenderOptions = {
  detailLevel?: 'default' | 'more' | 'full';
} & Record<string, unknown>;

export type TransportDetailLevel = 'default' | 'more' | 'full';

export interface ToolContract<TInput = unknown, TOutput = unknown, TOptions extends RenderOptions = RenderOptions> {
  definition: ToolDefinition;
  execute: (input: TInput) => TOutput | Promise<TOutput>;
  renderText: (result: TOutput, options?: TOptions) => string;
  renderJSON: (result: TOutput, options?: TOptions) => unknown;
  outputSchema: ToolOutputSchema;
  mergeRuntimeExtras?: (canonicalJSON: unknown, rawResult: unknown) => unknown;
  /** 详查工具：在 base 工具的完整输入上追加 selector 查询参数，对同一张盘做局部深查 */
  derivesFrom?: DerivedToolSource;
}

export interface DerivedToolSource {
  base: string;
  selector: ToolInputSchema;
}

export function defineToolContract<TInput, TOutput, TOptions extends RenderOptions = RenderOptions>(
  contract: ToolContract<TInput, TOutput, TOptions>,
): ToolContract<TInput, TOutput, TOptions> {
  return {
    ...contract,
    outputSchema: completeOutputSchema(contract.definition.name, contract.outputSchema),
  };
}

/** 只影响渲染详略的字段：不继承 base 的取值，也不交给 base 计算或 derive */
const RENDER_ONLY_FIELDS = new Set(['detailLevel']);
const ROOT_COMBINATORS = ['anyOf', 'oneOf', 'not', 'if'] as const;

/** 详查工具自己的详略：只决定文本是否附带判定口径，结构化结果不分详略 */
export const DERIVED_DETAIL_LEVEL_SCHEMA: ToolSchema = {
  type: 'string',
  enum: ['default', 'full'],
  default: 'default',
  description: '文本详略：default=只列所查事实；full=另附判定口径（结构化结果始终带口径与计算规则）',
};

function withDerivedDetailLevel(selector: ToolInputSchema): ToolInputSchema {
  if ('detailLevel' in selector.properties) throw new Error('详查参数不能自定义 detailLevel');
  return { ...selector, properties: { ...selector.properties, detailLevel: DERIVED_DETAIL_LEVEL_SCHEMA } };
}

function rootConstraints(schema: ToolSchema): ToolSchema[] {
  const constraints = [...(schema.allOf ?? [])];
  for (const key of ROOT_COMBINATORS) {
    if (schema[key] === undefined) continue;
    constraints.push(key === 'if'
      ? { if: schema.if, ...(schema.then ? { then: schema.then } : {}), ...(schema.else ? { else: schema.else } : {}) }
      : { [key]: schema[key] });
  }
  return constraints;
}

/**
 * 合并 base 输入与 selector：属性不得重名，required 取并集，根约束收进 allOf。
 * 示例按下标配对，保证每个公开示例都能直接执行。
 */
export function composeInputSchema(base: ToolInputSchema, selector: ToolInputSchema): ToolInputSchema {
  const properties: Record<string, ToolSchema> = {};
  for (const [key, schema] of Object.entries(base.properties)) {
    if (!RENDER_ONLY_FIELDS.has(key)) properties[key] = schema;
  }
  for (const [key, schema] of Object.entries(selector.properties)) {
    if (key in properties) throw new Error(`详查参数与基础参数重名: ${key}`);
    properties[key] = schema;
  }
  const required = [...new Set([...(base.required ?? []), ...(selector.required ?? [])])]
    .filter((key) => key in properties);
  const allOf = [...rootConstraints(base), ...rootConstraints(selector)];
  const baseExamples = (base.examples ?? [{}]) as Record<string, unknown>[];
  const selectorExamples = (selector.examples ?? [{}]) as Record<string, unknown>[];
  const count = Math.max(baseExamples.length, selectorExamples.length);
  const examples = Array.from({ length: count }, (_, i) => {
    const { detailLevel: _detailLevel, ...baseExample } = baseExamples[i % baseExamples.length];
    return { ...baseExample, ...selectorExamples[i % selectorExamples.length] };
  });
  return {
    type: 'object',
    properties,
    required,
    ...(allOf.length > 0 ? { allOf } : {}),
    ...(base.additionalProperties === undefined ? {} : { additionalProperties: base.additionalProperties }),
    examples,
  };
}

export interface DerivedToolSpec<TBaseInput, TBaseOutput, TSelector, TOutput, TOptions extends RenderOptions> {
  base: ToolContract<TBaseInput, TBaseOutput>;
  name: string;
  description: string;
  selector: ToolInputSchema;
  derive: (baseOutput: TBaseOutput, selector: TSelector, baseInput: TBaseInput) => TOutput | Promise<TOutput>;
  renderText: (result: TOutput, options?: TOptions) => string;
  renderJSON: (result: TOutput, options?: TOptions) => unknown;
  outputSchema: ToolOutputSchema;
}

/** 按 selector 的属性名把详查输入拆回 base 输入与查询参数；只影响渲染的字段两边都不给 */
export function splitDerivedInput(selector: ToolInputSchema, input: Record<string, unknown>): {
  baseInput: Record<string, unknown>;
  selection: Record<string, unknown>;
} {
  const baseInput: Record<string, unknown> = {};
  const selection: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (RENDER_ONLY_FIELDS.has(key)) continue;
    if (key in selector.properties) selection[key] = value;
    else baseInput[key] = value;
  }
  return { baseInput, selection };
}

export function defineDerivedToolContract<TBaseInput, TBaseOutput, TSelector, TOutput, TOptions extends RenderOptions = RenderOptions>(
  spec: DerivedToolSpec<TBaseInput, TBaseOutput, TSelector, TOutput, TOptions>,
): ToolContract<TBaseInput & TSelector, TOutput, TOptions> {
  // 对外的查询参数 = 详查自己的 selector + 详略；Agent 侧的参数表也取自这里（derivesFrom.selector）
  const selector = withDerivedDetailLevel(spec.selector);
  const inputSchema = composeInputSchema(spec.base.definition.inputSchema, selector);
  return defineToolContract<TBaseInput & TSelector, TOutput, TOptions>({
    definition: {
      name: spec.name,
      description: spec.description,
      inputSchema,
      ...(spec.base.definition.annotations ? { annotations: spec.base.definition.annotations } : {}),
    },
    execute: async (input) => {
      const { baseInput, selection } = splitDerivedInput(selector, input as Record<string, unknown>);
      const baseOutput = await spec.base.execute(baseInput as TBaseInput);
      return spec.derive(baseOutput, selection as TSelector, baseInput as TBaseInput);
    },
    renderText: spec.renderText,
    renderJSON: spec.renderJSON,
    outputSchema: spec.outputSchema,
    // 运行时附加信息（如出生地解析）按 base 的口径合并
    ...(spec.base.mergeRuntimeExtras ? { mergeRuntimeExtras: spec.base.mergeRuntimeExtras } : {}),
    derivesFrom: { base: spec.base.definition.name, selector },
  });
}

export function normalizeTransportDetailLevel(detailLevel: unknown): TransportDetailLevel {
  if (detailLevel === 'full') return 'full';
  if (detailLevel === 'more') return 'more';
  return 'default';
}

export function mergePlaceResolutionInfo(canonicalJSON: unknown, rawResult: unknown): unknown {
  if (typeof canonicalJSON !== 'object' || canonicalJSON === null) return canonicalJSON;
  if (typeof rawResult !== 'object' || rawResult === null) return canonicalJSON;
  if (!('placeResolutionInfo' in rawResult)) return canonicalJSON;

  return {
    ...canonicalJSON,
    placeResolutionInfo: (rawResult as { placeResolutionInfo?: unknown }).placeResolutionInfo,
  };
}
