import type { DerivedToolSource, ListedToolDefinition, ToolDefinition } from './contract.js';
import { toolByName, tools } from './tools.js';
import { validateInput } from './input-validator.js';

export function getToolTitle(definition: Pick<ToolDefinition, 'name' | 'description' | 'title'>): string {
  const explicitTitle = definition.title?.trim();
  if (explicitTitle) return explicitTitle;

  const [descriptionTitle] = definition.description.split(/\s+-\s+/, 1);
  return descriptionTitle?.trim() || definition.name;
}

export function listToolDefinitions(): ListedToolDefinition[] {
  return tools.map((tool) => ({
    ...tool.definition,
    title: getToolTitle(tool.definition),
    outputSchema: tool.outputSchema,
  }));
}

export function getToolContract(name: string) {
  return toolByName.get(name);
}

/** 详查工具的 base 工具与查询参数；普通工具返回 undefined */
export function getDerivedToolSource(name: string): DerivedToolSource | undefined {
  const source = toolByName.get(name)?.derivesFrom;
  return source ? structuredClone(source) : undefined;
}

export async function executeTool(name: string, args: unknown): Promise<unknown> {
  const tool = getToolContract(name);
  if (!tool) {
    const availableTools = listToolDefinitions().map((item) => item.name).join(', ');
    throw new Error(`未知工具: ${name}。可用的工具: ${availableTools}`);
  }

  validateInput(args, tool.definition.inputSchema);
  return tool.execute(args);
}
