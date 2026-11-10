'use client';

/**
 * 内置技能：太卜占术随版本提供、只读。方法正文是写给模型的断法与工具流程，不在界面展开；
 * 用户只需要知道有这个技能、它覆盖哪些体系。
 */
import { useId } from 'react';
import '../mcp/mcp-settings.css';
import './skill-settings.css';

const SKILL_NAME = 'taibu-divination';
const SKILL_TITLE = '太卜占术';
const SKILL_DESCRIPTION = '八字、紫微斗数、六爻、梅花易数、奇门遁甲、大六壬、小六壬、太乙、塔罗、西方占星、黄历择日与周公解梦的排盘与方法；盘面一律由工具计算。';

export function BuiltinMethods() {
    const id = useId();
    return (
        <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
            <div className="mcp-toolbar">
                <p id={`${id}-title`}>
                    <strong className="text-foreground">内置技能</strong>随版本提供、只读；Agent 会按问题自动选择其中的方法，盘面一律由 Core 工具计算。
                </p>
            </div>
            <ul className="settings-list-card" aria-label="内置技能">
                <li className="settings-list-item mcp-server">
                    <div className="settings-list-item-text">
                        <strong className="mcp-server-title">
                            {SKILL_TITLE}
                            <span className="mcp-badge mcp-badge-muted">内置</span>
                            <span className="mcp-badge mcp-badge-muted">官方</span>
                        </strong>
                        <p className="skill-description">{SKILL_DESCRIPTION}</p>
                        <p className="mcp-server-line"><span className="skill-name">{SKILL_NAME}</span></p>
                    </div>
                </li>
            </ul>
        </section>
    );
}
