'use client';
// 'use client'：问题面板需要分步状态、本地草稿与附件上传

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { CircleHelp, LoaderCircle, Paperclip, X } from 'lucide-react';
import { normalizeQuestions, validateAnswers, formatQuestionAnswers, type AgentAnswers, type AgentQuestion } from '@/lib/agent/questions';
import { getDraftAnswers, questionDraftKey } from '@/lib/agent/question-drafts';
import { useQuestionDraft } from '@/lib/agent/use-question-draft';
import type { AttachmentState } from '@/types';
import { usePrivateAttachments } from '@/lib/chat/use-private-attachments';
import { PRIVATE_ATTACHMENT_ACCEPT } from '@/lib/chat/composer-files';
import { PrivateAttachments } from './PrivateAttachments';

/** Two short choices sit side by side; longer or more choices stack. */
const gridOptions = (question: AgentQuestion) => (question.options?.length ?? 0) === 2 && question.options!.every(option => option.label.length <= 8);

/**
 * Answers the Agent's questions in the composer's place. Drafts persist per owner, conversation,
 * run and tool call; “稍后回答” folds the panel into a strip and hands the input back until the user returns.
 */
export function AgentQuestionDock({ question, questions: supplied, questionId, scopeKey, onAnswer, onStop, disabled, attachmentState, onAttachmentChange, collapsed, onCollapsedChange }: {
    question: string; questions?: AgentQuestion[]; questionId: string; scopeKey: string;
    onAnswer: (answer: string, answers: AgentAnswers) => Promise<void>; onStop: () => void; disabled: boolean;
    attachmentState: AttachmentState; onAttachmentChange: (state: AttachmentState) => void;
    collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void;
}) {
    const id = useId();
    const fileRef = useRef<HTMLInputElement>(null);
    const expandRef = useRef<HTMLButtonElement>(null);
    const laterRef = useRef<HTMLButtonElement>(null);
    const questions = useMemo(() => normalizeQuestions(supplied, question), [supplied, question]);
    // The workspace's question view reads the same draft while it is typed.
    const { draft, update, clear } = useQuestionDraft(questionDraftKey(scopeKey, questionId), questions);
    // Reopening a saved draft lands on the first unanswered question; everything answered opens the last one for submit.
    const [step, setStep] = useState(() => {
        const first = questions.findIndex(q => draft.answers[q.id] !== null && !draft.answers[q.id]?.length && !draft.custom[q.id]?.trim());
        return first < 0 ? Math.max(0, questions.length - 1) : first;
    });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // 有选项时「自行填写」默认收起，需要时再展开；已填过的草稿自动展开。
    const [customOpen, setCustomOpen] = useState<string | null>(null);
    const uploads = usePrivateAttachments({ scopeKey, state: attachmentState, change: onAttachmentChange, onError: setError });
    const effective = getDraftAnswers(questions, draft);
    const answered = (q: AgentQuestion) => effective[q.id] === null || !!effective[q.id]?.length;
    const current = questions[step];
    const last = step === questions.length - 1;
    let ready = false; try { validateAnswers(questions, effective); ready = true; } catch { /* incomplete */ }
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!last) { if (answered(current)) setStep(step + 1); return; }
        if (sending || uploads.uploading || disabled || !ready) return;
        setSending(true); setError(null);
        try { await onAnswer(formatQuestionAnswers(questions, effective), effective); clear(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '回答发送失败，请重试'); }
        finally { setSending(false); }
    };
    const skip = () => {
        update({ answers: { ...draft.answers, [current.id]: null }, custom: { ...draft.custom, [current.id]: '' } });
        if (!last) setStep(step + 1);
    };
    // 单选选中即进入下一题（pi 式单卡逐步）；多选题留在原地继续勾选。
    const choose = (optionId: string) => {
        update({ answers: { ...draft.answers, [current.id]: [optionId] }, custom: { ...draft.custom, [current.id]: '' } });
        if (!last) setStep(step + 1);
    };
    const collapse = () => { if (sending) return; onCollapsedChange(true); requestAnimationFrame(() => expandRef.current?.focus()); };
    const expand = () => { onCollapsedChange(false); requestAnimationFrame(() => laterRef.current?.focus()); };

    if (collapsed) return <div className="agent-question-strip" role="group" aria-label="等待回答">
        <CircleHelp size={15} aria-hidden="true" />
        <span>回答 {questions.length} 个问题后继续任务</span>
        <Button unstyled type="button" className="agent-question-strip-stop" disabled={disabled} onClick={onStop}>停止任务</Button>
        <Button unstyled ref={expandRef} type="button" className="agent-question-strip-answer" onClick={expand}>回答问题</Button>
    </div>;

    const [title, ...hintLines] = current?.question.split('\n') ?? [];
    const hint = hintLines.join(' ').trim();
    const showCustom = !current?.options?.length || customOpen === current.id || !!draft.custom[current.id]?.trim();
    const custom = current && showCustom && <>
        {current.allowCustom && <div className="agent-question-custom">
            {!!current.options?.length && <label htmlFor={`${id}-answer`}>自行填写</label>}
            <Textarea id={`${id}-answer`} rows={1} value={draft.custom[current.id] ?? ''} maxLength={8000} disabled={sending || disabled}
                aria-label={current.options?.length ? undefined : title}
                placeholder={current.options?.length ? '其他情况，可直接写' : '填写你的回答'}
                onChange={event => update({ answers: { ...draft.answers, [current.id]: current.multiple ? draft.answers[current.id] ?? [] : [] }, custom: { ...draft.custom, [current.id]: event.target.value } })} />
        </div>}
    </>;
    const customToggle = current?.options?.length && current.allowCustom && !showCustom && (
        <Button unstyled type="button" className="agent-question-custom-toggle" onClick={() => setCustomOpen(current.id)}>其他情况，可直接写</Button>
    );

    return <section className="agent-question-dock" aria-labelledby={`${id}-title`}>
        <div className="agent-question-dock-header">
            <span className="agent-question-dock-icon" aria-hidden="true"><CircleHelp size={14} /></span>
            <h2 id={`${id}-title`}>{questions.length > 1 ? `问题 ${step + 1} / ${questions.length}` : '太卜需要补充信息'}</h2>
            <Button unstyled ref={laterRef} type="button" className="agent-question-later" disabled={sending} onClick={collapse}
                aria-label="稍后回答" title="稍后回答"><X size={16} aria-hidden="true" /></Button>
        </div>
        <form onSubmit={submit}>
            <div className="agent-question-body">
                {current.options?.length ? <fieldset>
                    <legend className="agent-question-title">{title}{(current.multiple || current.allowSkip) && <small>{[current.multiple && '可多选', current.allowSkip && '可跳过'].filter(Boolean).join(' · ')}</small>}</legend>
                    {hint && <p className="agent-question-hint">{hint}</p>}
                    {current.multiple ? <div className={`agent-question-options${gridOptions(current) ? ' is-grid' : ''}`}>
                        {current.options.map(option => <label key={option.id} className="agent-question-option">
                            <Checkbox checked={draft.answers[current.id]?.includes(option.id) ?? false} disabled={sending || disabled}
                                onCheckedChange={() => {
                                    const previous = draft.answers[current.id] ?? [];
                                    const next = previous.includes(option.id) ? previous.filter(value => value !== option.id) : [...previous, option.id];
                                    update({ answers: { ...draft.answers, [current.id]: next }, custom: draft.custom });
                                }} />{option.label}
                        </label>)}
                    </div> : <RadioGroup
                        aria-label={title}
                        value={draft.answers[current.id]?.[0] ?? ''}
                        onChange={choose}
                        options={current.options.map(option => ({ value: option.id, label: option.label }))}
                        className={`agent-question-options${gridOptions(current) ? ' is-grid' : ''}`}
                        optionClassName="agent-question-option"
                    />}
                    {customToggle}
                    {custom}
                </fieldset> : <div className="agent-question-field">
                    <label htmlFor={`${id}-answer`} className="agent-question-title">{title}{current.allowSkip && <small>可跳过</small>}</label>
                    {hint && <p className="agent-question-hint">{hint}</p>}
                    {custom}
                </div>}
                <PrivateAttachments items={attachmentState.uploaded} disabled={uploads.uploading || sending} onRemove={removed => onAttachmentChange({ ...attachmentState, uploaded: attachmentState.uploaded?.filter(item => item.id !== removed) })} />
                <Button unstyled type="button" className="agent-question-attach" disabled={sending || uploads.uploading || disabled} onClick={() => fileRef.current?.click()}>
                    <Paperclip size={14} aria-hidden="true" />{uploads.uploading ? '正在保存资料…' : '添加图片或文本资料'}
                </Button>
                <input ref={fileRef} type="file" className="hidden" tabIndex={-1} aria-hidden="true" multiple accept={PRIVATE_ATTACHMENT_ACCEPT}
                    onChange={event => { void uploads.upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
                {error && <p className="agent-error" role="alert">{error}</p>}
            </div>
            <div className="agent-question-footer">
                <Button unstyled type="button" className="agent-question-previous" disabled={sending || step === 0} onClick={() => setStep(step - 1)}>上一题</Button>
                {current.allowSkip && <Button unstyled type="button" className="agent-question-skip" disabled={sending || disabled} onClick={skip}>跳过此题</Button>}
                <span className="chat-toolbar-spacer" />
                <Button unstyled type="submit" className="agent-question-next" disabled={sending || disabled || (last ? !ready : !answered(current))}>
                    {sending && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    {sending ? '正在发送' : last ? '提交并继续' : '下一题'}
                </Button>
            </div>
        </form>
    </section>;
}
