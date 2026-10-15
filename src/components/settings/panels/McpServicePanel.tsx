/**
 * MCP 接入说明
 *
 * 'use client' 标记说明：
 * - 需要 useState 切换接入方式标签页，并调用剪贴板 API 复制配置
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Cloud, Copy, Terminal } from 'lucide-react';
import {
  SettingsTabs,
  getSettingsTabId,
  getSettingsTabPanelId,
  type SettingsTabOption,
} from '@/components/settings/SettingsControls';
import {
  MCP_PUBLIC_TOOLS,
  MCP_PUBLIC_URL,
  MCP_STDIO_PACKAGE_NAME,
  buildMcpPublicHttpConfig,
  buildMcpStdioNpxConfig,
} from '@/lib/mcp-service-config';

type McpConnectionMode = 'remote' | 'stdio';

const CONNECTION_TABS: SettingsTabOption<McpConnectionMode>[] = [
  { id: 'remote', label: '远程服务', icon: Cloud },
  { id: 'stdio', label: '本地 Stdio', icon: Terminal },
];
const TAB_ID_PREFIX = 'mcp';

const REMOTE_CONFIG = buildMcpPublicHttpConfig();
const STDIO_CONFIG = buildMcpStdioNpxConfig();
const CARD = 'rounded-[14px] border border-border bg-surface';
const COPIED_RESET_MS = 2000;

function ConfigBlock({
  snippet,
  copied,
  onCopy,
}: {
  snippet: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className={`overflow-hidden ${CARD}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border py-2 pl-5 pr-2.5">
        <span className="text-[13px] text-foreground-secondary">客户端配置</span>
        <button
          type="button"
          onClick={onCopy}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-colors duration-150 hover:bg-background-secondary ${copied ? 'text-success' : 'text-foreground-secondary hover:text-foreground'}`}
        >
          {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto bg-background-secondary/60 px-5 py-4 font-mono text-[13px] leading-relaxed text-foreground">{snippet}</pre>
    </div>
  );
}

export default function McpServicePanel() {
  const [mode, setMode] = useState<McpConnectionMode>('remote');
  const [copiedSnippet, setCopiedSnippet] = useState<McpConnectionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  const copy = async (snippetId: McpConnectionMode, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setError(null);
      setCopiedSnippet(snippetId);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopiedSnippet(null), COPIED_RESET_MS);
    } catch {
      setError('复制失败，请手动选择配置内容。');
    }
  };

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-col gap-4">
        {error ? (
          <div role="alert" className="settings-alert">{error}</div>
        ) : null}

        <SettingsTabs label="MCP 接入方式" idPrefix={TAB_ID_PREFIX} tabs={CONNECTION_TABS} value={mode} onChange={setMode} />

        {mode === 'remote' ? (
          <section id={getSettingsTabPanelId(TAB_ID_PREFIX, 'remote')} role="tabpanel" aria-labelledby={getSettingsTabId(TAB_ID_PREFIX, 'remote')} className="flex flex-col gap-4">
            <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${CARD}`}>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h3 className="text-[15px] font-medium text-foreground">公开 Streamable HTTP</h3>
                <code className="break-all font-mono text-[13px] text-foreground-secondary">{MCP_PUBLIC_URL}</code>
              </div>
              <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs text-success">无需认证</span>
            </div>
            <ConfigBlock snippet={REMOTE_CONFIG} copied={copiedSnippet === 'remote'} onCopy={() => { void copy('remote', REMOTE_CONFIG); }} />
            <p className="settings-help">
              支持 Streamable HTTP 的客户端直接填入上面的地址即可；只支持 Stdio 的客户端请切换到「本地 Stdio」。
            </p>
          </section>
        ) : (
          <section id={getSettingsTabPanelId(TAB_ID_PREFIX, 'stdio')} role="tabpanel" aria-labelledby={getSettingsTabId(TAB_ID_PREFIX, 'stdio')} className="flex flex-col gap-4">
            <div className={`flex flex-col gap-1.5 px-5 py-4 ${CARD}`}>
              <h3 className="text-[15px] font-medium text-foreground">本地进程</h3>
              <p className="text-[13px] leading-relaxed text-foreground-secondary">
                客户端通过 <code className="font-mono">npx -y {MCP_STDIO_PACKAGE_NAME}</code> 在本机启动服务，需要 Node.js 和支持 Stdio 的 MCP 客户端。
              </p>
            </div>
            <ConfigBlock snippet={STDIO_CONFIG} copied={copiedSnippet === 'stdio'} onCopy={() => { void copy('stdio', STDIO_CONFIG); }} />
          </section>
        )}
      </div>

      <section aria-labelledby="mcp-tools-heading" className="flex flex-col gap-3">
        <h3 id="mcp-tools-heading" className="text-[13px] font-medium text-foreground-tertiary">
          可用工具<span className="ml-1.5 font-normal">{MCP_PUBLIC_TOOLS.length}</span>
        </h3>
        {/* 分隔线画在每格右侧和下方，被外框裁掉最外一圈；末行不满时空格保持白底。 */}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] overflow-hidden rounded-[14px] border border-border bg-surface">
          {MCP_PUBLIC_TOOLS.map((tool) => (
            <li key={tool.id} className="flex min-w-0 items-baseline justify-between gap-3 px-4 py-2.5 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)] sm:flex-col sm:items-start sm:justify-start sm:gap-1 sm:py-3">
              <code className="truncate font-mono text-[13px] text-foreground">{tool.id}</code>
              <span className="flex-shrink-0 text-[13px] text-foreground-secondary">{tool.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
