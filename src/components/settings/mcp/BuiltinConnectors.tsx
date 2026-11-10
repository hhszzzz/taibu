'use client';

/**
 * 内置连接器：管理员接入、对所有用户开放，只读；列出名称与用途，个人连接器在下面的列表里管理。
 */
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { fetchAgentConnectors, type AgentConnector } from '@/lib/agent/mcp/client';
import './mcp-settings.css';

export function BuiltinConnectors() {
    const [connectors, setConnectors] = useState<AgentConnector[] | null>(null);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const id = useId();

    useEffect(() => {
        const controller = new AbortController();
        fetchAgentConnectors(controller.signal).then(
            items => { if (!controller.signal.aborted) setConnectors(items.filter(item => item.scope === 'platform')); },
            loadError => { if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : '读取内置连接器失败'); },
        );
        return () => controller.abort();
    }, [reload]);

    if (error) {
        return (
            <div role="alert" className="settings-alert">
                <span className="min-w-0 flex-1">{error}</span>
                <Button variant="ghost" size="xs" onClick={() => { setError(''); setConnectors(null); setReload(value => value + 1); }}>重试</Button>
            </div>
        );
    }

    return (
        <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
            <div className="mcp-toolbar">
                <p id={`${id}-title`}>
                    <strong className="text-foreground">内置连接器</strong>；开启的 Agent 任务可以直接调用。
                </p>
                {connectors ? <span className="mcp-badge mcp-badge-muted">{connectors.length} 个连接器</span> : null}
            </div>
            {connectors === null ? (
                <div className="mcp-empty"><SoundWaveLoader variant="inline" /></div>
            ) : connectors.length === 0 ? (
                <div className="mcp-empty"><p>还没有内置连接器。</p></div>
            ) : (
                <ul className="settings-list-card" aria-label="内置连接器">
                    {connectors.map(connector => (
                        <li key={connector.id} className="settings-list-item">
                            <div className="settings-list-item-text">
                                <strong className="mcp-server-title">
                                    {connector.name}
                                    <span className="mcp-badge mcp-badge-muted">内置</span>
                                </strong>
                                {connector.description ? <p>{connector.description}</p> : null}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
