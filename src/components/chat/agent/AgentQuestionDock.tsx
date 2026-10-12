'use client';
// 'use client'：问题面板需要分步状态、本地草稿与附件上传

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { CircleHelp, LoaderCircle, Paperclip } from 'lucide-react';
import { normalizeQuestions, validateAnswers, formatQuestionAnswers, questionLabel, type AgentAnswers, type AgentQuestion } from '@/lib/agent/questions';
import { describeQuestionAnswer, getDraftAnswers, questionDraftKey } from '@/lib/agent/question-drafts';
import { useQuestionDraft } from '@/lib/agent/use-question-draft';
import type { AttachmentState } from '@/types';
import { usePrivateAttachments } from '@/lib/chat/use-private-attachments';
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
    // Reopening a saved draft lands on the first unanswered question, or the review when all are answered.
    const [step, setStep] = useState(() => {
        const first = questions.findIndex(q => draft.answers[q.id] !== null && !draft.answers[q.id]?.length && !draft.custom[q.id]?.trim());
        return first < 0 ? questions.length : first;
    });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const uploads = usePrivateAttachments({ scopeKey, state: attachmentState, change: onAttachmentChange, onError: setError });
    const effective = getDraftAnswers(questions, draft);
    const answered = (q: AgentQuestion) => effective[q.id] === null || !!effective[q.id]?.length;
    const current = questions[step];
    const summary = step === questions.length;
    let ready = false; try { validateAnswers(questions, effective); ready = true; } catch { /* incomplete */ }
    const answerText = (q: AgentQuestion) => describeQuestionAnswer(q, effective[q.id]) ?? '尚未回答';
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!summary) { setStep(Math.min(step + 1, questions.length)); return; }
        if (sending || uploads.uploading || disabled || !ready) return;
        setSending(true); setError(null);
        try { await onAnswer(formatQuestionAnswers(questions, effective), effective); clear(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '回答发送失败，请重试'); }
        finally { setSending(false); }
    };
    const collapse = () => { if (sending) return; onCollapsedChange(true); requestAnimationFrame(() => expandRef.current?.focus()); };
    const expand = () => { onCollapsedChange(false); requestAnimationFrame(() => laterRef.current?.focus()); };

    if (collapsed) return <div className="agent-question-strip" role="group" aria-label="等待回答">
        <CircleHelp size={15} aria-hidden="true" />
        <span>回答 {questions.length} 个问题后继续任务</span>
        <button type="button" className="agent-question-strip-stop" disabled={disabled} onClick={onStop}>停止任务</button>
        <button ref={expandRef} type="button" className="agent-question-strip-answer" onClick={expand}>回答问题</button>
    </div>;

    const [title, ...hintLines] = current?.question.split('\n') ?? [];
    const hint = hintLines.join(' ').trim();
    const custom = current && <>
        {current.allowCustom && <div className="agent-question-custom">
            {!!current.options?.length && <label htmlFor={`${id}-answer`}>自行填写</label>}
            <textarea id={`${id}-answer`} rows={1} value={draft.custom[current.id] ?? ''} maxLength={8000} disabled={sending || disabled}
                aria-label={current.options?.length ? undefined : title}
                placeholder={current.options?.length ? '其他情况，可直接写' : '填写你的回答'}
                onChange={event => update({ answers: { ...draft.answers, [current.id]: current.multiple ? draft.answers[current.id] ?? [] : [] }, custom: { ...draft.custom, [current.id]: event.target.value } })} />
        </div>}
    </>;

    return <section className="agent-question-dock" aria-labelledby={`${id}-title`}>
        <div className="agent-question-dock-header">
            <span className="agent-question-dock-icon" aria-hidden="true"><CircleHelp size={15} /></span>
            <div>
                <h2 id={`${id}-title`}>太卜需要补充 {questions.length} 项信息</h2>
                <p>回答后继续同一任务 · 关闭页面也会保留问题和草稿</p>
            </div>
            <button ref={laterRef} type="button" className="agent-question-later" disabled={sending} onClick={collapse}>稍后回答</button>
        </div>
        <nav className="agent-question-steps" aria-label="问题导航">
            {questions.map((q, index) => <button key={q.id} type="button" aria-current={step === index ? 'step' : undefined} data-answered={answered(q)} onClick={() => setStep(index)}>
                <span aria-hidden="true">{effective[q.id] === null ? '–' : answered(q) ? '✓' : index + 1}</span>{questionLabel(q)}
            </button>)}
            <button type="button" aria-current={summary ? 'step' : undefined} data-answered={ready} onClick={() => setStep(questions.length)}>
                <span aria-hidden="true">✓</span>检查
            </button>
        </nav>
        <form onSubmit={submit}>
            <div className="agent-question-body">
                {summary ? <div className="agent-question-review">
                    <div className="agent-question-title">提交前检查</div>
                    <dl>{questions.map(q => <div key={q.id}><dt>{questionLabel(q)}</dt><dd data-empty={!answered(q)}>{answerText(q)}</dd></div>)}</dl>
                </div> : current.options?.length ? <fieldset>
                    <legend className="agent-question-title">{title}{(current.multiple || current.allowSkip) && <small>{[current.multiple && '可多选', current.allowSkip && '可跳过'].filter(Boolean).join(' · ')}</small>}</legend>
                    {hint && <p className="agent-question-hint">{hint}</p>}
                    <div className={`agent-question-options${gridOptions(current) ? ' is-grid' : ''}`}>
                        {current.options.map(option => <label key={option.id} className="agent-question-option">
                            <input type={current.multiple ? 'checkbox' : 'radio'} name={`${id}-${current.id}`} checked={draft.answers[current.id]?.includes(option.id) ?? false} disabled={sending || disabled}
                                onChange={() => {
                                    const previous = draft.answers[current.id] ?? [];
                                    const next = current.multiple ? previous.includes(option.id) ? previous.filter(value => value !== option.id) : [...previous, option.id] : [option.id];
                                    update({ answers: { ...draft.answers, [current.id]: next }, custom: current.multiple ? draft.custom : { ...draft.custom, [current.id]: '' } });
                                }} />{option.label}
                        </label>)}
                    </div>
                    {custom}
                </fieldset> : <div className="agent-question-field">
                    <label htmlFor={`${id}-answer`} className="agent-question-title">{title}{current.allowSkip && <small>可跳过</small>}</label>
                    {hint && <p className="agent-question-hint">{hint}</p>}
                    {custom}
                </div>}
                <PrivateAttachments items={attachmentState.uploaded} disabled={uploads.uploading || sending} onRemove={removed => onAttachmentChange({ ...attachmentState, uploaded: attachmentState.uploaded?.filter(item => item.id !== removed) })} />
                <button type="button" className="agent-question-attach" disabled={sending || uploads.uploading || disabled} onClick={() => fileRef.current?.click()}>
                    <Paperclip size={14} aria-hidden="true" />{uploads.uploading ? '正在保存资料…' : '添加图片或文本资料'}
                </button>
                <input ref={fileRef} type="file" className="hidden" tabIndex={-1} aria-hidden="true" multiple accept=".jpg,.jpeg,.png,.webp,.txt,.md"
                    onChange={event => { void uploads.upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
                {error && <p className="agent-error" role="alert">{error}</p>}
            </div>
            <div className="agent-question-footer">
                <span>{summary ? ready ? '已全部回答，可以提交' : '还有问题未回答' : `第 ${step + 1} / ${questions.length} 题`}</span>
                {!summary && current.allowSkip && <button type="button" className="agent-question-skip" disabled={sending || disabled}
                    onClick={() => { update({ answers: { ...draft.answers, [current.id]: null }, custom: { ...draft.custom, [current.id]: '' } }); setStep(step + 1); }}>跳过此题</button>}
                <button type="button" className="agent-question-previous" disabled={sending || step === 0} onClick={() => setStep(step - 1)}>上一题</button>
                <button type="submit" className="agent-question-next" disabled={sending || disabled || (summary && !ready)}>
                    {sending && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
                    {sending ? '正在发送' : summary ? '提交并继续' : step === questions.length - 1 ? '检查回答' : '下一题'}
                </button>
            </div>
        </form>
    </section>;
}
