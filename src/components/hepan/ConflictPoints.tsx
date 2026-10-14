/**
 * 冲突点展示组件
 *
 * 包含冲突触发因素和沟通建议模板
 *
 * 'use client'：展开 / 话术模板切换需要 useState
 */
'use client';

import { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, ChevronDown, MessageCircle, Shield, Lightbulb, CheckCircle2 } from 'lucide-react';
import { type ConflictPoint, type HepanType } from '@/lib/divination/hepan';
import { getCommunicationTemplate, getSeverityAdvice, type CommunicationTemplate } from '@/lib/communication-templates';

interface ConflictPointsProps {
    conflicts: ConflictPoint[];
    hepanType: HepanType;
}

const SEVERITY_CONFIG = {
    high: {
        icon: AlertTriangle,
        bgColor: 'bg-danger/10',
        iconColor: 'text-danger',
        label: '高度关注',
    },
    medium: {
        icon: AlertCircle,
        bgColor: 'bg-warning/10',
        iconColor: 'text-warning',
        label: '中度关注',
    },
    low: {
        icon: Info,
        bgColor: 'bg-water-soft',
        iconColor: 'text-water',
        label: '轻度留意',
    },
} as const;

export function ConflictPoints({ conflicts, hepanType }: ConflictPointsProps) {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
    const [showTemplate, setShowTemplate] = useState<number | null>(null);

    if (conflicts.length === 0) {
        return (
            <div className="rounded-2xl border-[0.5px] border-border bg-surface p-8 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
                    <CheckCircle2 className="h-7 w-7 text-success" />
                </div>
                <h3 className="mb-2 font-display text-lg text-foreground">暂未发现明显冲突点</h3>
                <p className="mx-auto max-w-sm text-sm text-foreground-secondary">
                    双方八字配合良好，能量场和谐互补，关系发展将会比较顺利。
                </p>
            </div>
        );
    }


    const toggleExpand = (index: number) => {
        setExpandedIndex(expandedIndex === index ? null : index);
        if (expandedIndex !== index) {
            setShowTemplate(null);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <h3 className="font-display text-lg text-foreground sm:text-[22px]">
                需要关注的问题
            </h3>

            {conflicts.map((conflict, index) => {
                const config = SEVERITY_CONFIG[conflict.severity];
                const Icon = config.icon;
                const isExpanded = expandedIndex === index;
                const template = getCommunicationTemplate(hepanType, conflict.title);
                const severityAdvice = getSeverityAdvice(conflict.severity);

                return (
                    <div
                        key={index}
                        className="overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface transition-colors duration-150 hover:border-border-hover"
                    >
                        {/* Summary Section */}
                        <div
                            className="cursor-pointer p-4 sm:p-5"
                            onClick={() => toggleExpand(index)}
                        >
                            <div className="flex items-start gap-3 sm:gap-4">
                                <div className={`shrink-0 rounded-xl p-2 ${config.bgColor} ${config.iconColor}`}>
                                    <Icon className="h-5 w-5" />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center flex-wrap gap-2 mb-2">
                                        <h4 className="text-base font-medium text-foreground">{conflict.title}</h4>
                                        <span className={`rounded-md px-2 py-0.5 text-xs ${config.bgColor} ${config.iconColor}`}>
                                            {config.label}
                                        </span>
                                    </div>

                                    <p className="text-foreground-secondary text-sm leading-relaxed mb-3">
                                        {conflict.description}
                                    </p>

                                    <div className="flex items-start gap-2 rounded-xl bg-panel p-3 text-sm">
                                        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
                                        <span className="text-foreground-secondary">{conflict.suggestion}</span>
                                    </div>
                                </div>

                                {conflict.triggerFactors && conflict.triggerFactors.length > 0 && (
                                    <button type="button" aria-expanded={isExpanded} aria-label={isExpanded ? '收起详情' : '展开详情'} className="p-1 text-foreground-secondary transition-colors hover:text-foreground">
                                        <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Expanded Details */}
                        {isExpanded && conflict.triggerFactors && (
                            <div className="space-y-6 border-t-[0.5px] border-border bg-background p-4 sm:p-5 animate-fade-in">
                                {/* Trigger Factors */}
                                <div>
                                    <h5 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                                        <Shield className="h-4 w-4 text-success" />
                                        常见触发情境与应对
                                    </h5>
                                    <div className="grid gap-3">
                                        {conflict.triggerFactors.map((trigger, tIdx) => (
                                            <div
                                                key={tIdx}
                                                className="rounded-xl border-[0.5px] border-border bg-surface p-4"
                                            >
                                                <div className="mb-2 text-sm font-medium text-foreground">
                                                    {trigger.scenario}
                                                </div>
                                                <div className="space-y-2 text-xs md:text-sm">
                                                    <div className="flex items-start gap-2 text-foreground-secondary">
                                                        <span className="shrink-0 font-medium text-danger">触发行为：</span>
                                                        {trigger.trigger}
                                                    </div>
                                                    <div className="flex items-start gap-2 text-foreground-secondary">
                                                        <span className="shrink-0 font-medium text-warning">警示：</span>
                                                        {trigger.warning}
                                                    </div>
                                                    <div className="flex items-start gap-2 text-foreground-secondary">
                                                        <span className="shrink-0 font-medium text-success">预防：</span>
                                                        {trigger.prevention}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Communication Template */}
                                <div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowTemplate(showTemplate === index ? null : index);
                                        }}
                                        type="button"
                                        aria-expanded={showTemplate === index}
                                        className={`flex w-full items-center justify-between rounded-xl p-4 transition-colors ${showTemplate === index
                                                ? 'bg-accent-light ring-1 ring-inset ring-accent/50'
                                                : 'border-[0.5px] border-border bg-surface hover:bg-background-secondary'
                                            }`}
                                    >
                                        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                                            <MessageCircle className="h-4 w-4 text-clay" />
                                            沟通建议与话术模板
                                        </span>
                                        <ChevronDown className={`w-4 h-4 text-foreground-secondary transition-transform duration-300 ${showTemplate === index ? 'rotate-180' : ''}`} />
                                    </button>

                                    {showTemplate === index && (
                                        <div className="mt-3 animate-fade-in">
                                            <CommunicationTemplateCard template={template} />
                                        </div>
                                    )}
                                </div>

                                {/* General Advice */}
                                <div className="rounded-xl bg-panel p-4">
                                    <h5 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                                        <Lightbulb className="h-4 w-4 text-clay" />
                                        通用建议
                                    </h5>
                                    <ul className="space-y-2">
                                        {severityAdvice.map((advice, aIdx) => (
                                            <li key={aIdx} className="text-sm text-foreground-secondary flex items-start gap-2.5">
                                                <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-clay" />
                                                {advice}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function CommunicationTemplateCard({ template }: { template: CommunicationTemplate }) {
    return (
        <div className="space-y-5 rounded-xl border-[0.5px] border-border bg-surface p-4 sm:p-5">
            <div>
                <h5 className="mb-1 text-sm font-medium text-foreground">{template.title}</h5>
                <p className="text-xs text-foreground-secondary">适用情境：{template.context}</p>
            </div>

            <div>
                <div className="mb-2 text-xs font-medium text-accent-strong">参考话术</div>
                <div className="relative rounded-xl bg-panel p-4 text-sm leading-relaxed text-foreground">
                    <span aria-hidden="true" className="absolute left-2 top-1 font-display text-2xl text-foreground-tertiary/50">&quot;</span>
                    <span className="relative z-10 block px-2">{template.script}</span>
                    <span aria-hidden="true" className="absolute bottom-0 right-2 font-display text-2xl text-foreground-tertiary/50">&quot;</span>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                <div>
                    <div className="mb-2 text-xs font-medium text-success">沟通技巧</div>
                    <ul className="space-y-2">
                        {template.tips.map((tip, idx) => (
                            <li key={idx} className="text-xs text-foreground-secondary flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                                {tip}
                            </li>
                        ))}
                    </ul>
                </div>

                <div>
                    <div className="mb-2 text-xs font-medium text-danger">避免用语</div>
                    <div className="flex flex-wrap gap-2">
                        {template.avoidPhrases.map((phrase, idx) => (
                            <span
                                key={idx}
                                className="rounded-md bg-danger/10 px-2 py-0.5 text-xs text-danger"
                            >
                                {phrase}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
