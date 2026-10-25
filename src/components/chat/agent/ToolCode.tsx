// 命令行配色的调用参数与原始 JSON：片段由 lib/agent/tool-display 切好，这里只按类别着色。

import type { DisplayToken } from '@/lib/agent/tool-display';
import { jsonTokens, joinTokens, toolCommandTokens } from '@/lib/agent/tool-display';

function Tokens({ tokens, className, label }: { tokens: readonly DisplayToken[]; className: string; label: string }) {
    return <pre className={`agent-code ${className}`} tabIndex={0} aria-label={label}><code>{tokens.map((token, index) =>
        token.kind === 'text' ? token.text : <span key={index} className={`agent-code-${token.kind}`}>{token.text}</span>)}</code></pre>;
}

/** `$ 工具名 --参数 值`：工具名用强调色，选项、字符串、数字、字面量各一色。 */
export function ToolCommand({ name, input, className = '' }: { name: string; input: unknown; className?: string }) {
    return <Tokens tokens={toolCommandTokens(name, input)} className={`agent-code--command ${className}`.trim()} label="调用参数" />;
}

export const toolCommandText = (name: string, input: unknown) => joinTokens(toolCommandTokens(name, input));

/** 原始结果：缩进两格、键与值分色的 JSON。 */
export function JsonCode({ value, label = '原始结果', className = '' }: { value: unknown; label?: string; className?: string }) {
    return <Tokens tokens={jsonTokens(value)} className={`agent-code--json ${className}`.trim()} label={label} />;
}
