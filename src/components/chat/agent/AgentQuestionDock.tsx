'use client';
// 'use client'：问题面板需要分步状态、本地草稿、键盘作答与附件上传

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Tooltip } from '@/components/ui/Tooltip';
import { ArrowLeft, Check, ChevronDown, CornerDownLeft, LoaderCircle, Paperclip, PenLine } from 'lucide-react';
import { normalizeQuestions, validateAnswers, formatQuestionAnswers, questionLabel, type AgentAnswers, type AgentQuestion } from '@/lib/agent/questions';
import { describeQuestionAnswer, getDraftAnswers, questionDraftKey } from '@/lib/agent/question-drafts';
import { useQuestionDraft } from '@/lib/agent/use-question-draft';
import type { AttachmentState } from '@/types';
import { usePrivateAttachments } from '@/lib/chat/use-private-attachments';
import { PRIVATE_ATTACHMENT_ACCEPT } from '@/lib/chat/composer-files';
import { PrivateAttachments } from './PrivateAttachments';

/** Choices of up to 6 characters sit side by side as chips; up to 16 share rows two or three at a time on a wide panel; longer ones stack. */
const optionLayout = (question: AgentQuestion): { chips?: true; columns?: 2 | 3 } => {
    const lengths = question.options?.map(option => [...option.label].length) ?? [];
    if (lengths.length <= 6 && lengths.every(length => length <= 6)) return { chips: true };
    if (!lengths.every(length => length <= 16)) return {};
    return { columns: lengths.length % 3 === 0 && lengths.every(length => length <= 10) ? 3 : 2 };
};
/** 单选点中后停一拍再翻页，让选中态被看见。 */
const ADVANCE_DELAY_MS = 260;
const isEnter = (event: KeyboardEvent) => event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
/** Where focus lands on a question: the answer box of an open question, otherwise the question itself, where number keys pick. */
const focusTarget = (pane: HTMLElement | null) => pane?.querySelector<HTMLElement>('.agent-question-text') ?? pane;

/**
 * Answers the Agent's questions in the composer's place, one question at a time: number keys pick,
 * Enter continues, Esc folds the panel into a strip. Drafts persist per owner, conversation, run and tool call.
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
    const nextRef = useRef<HTMLButtonElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const paneRef = useRef<HTMLDivElement>(null);
    const advanceTimer = useRef<number | null>(null);
    const questions = useMemo(() => normalizeQuestions(supplied, question), [supplied, question]);
    // The workspace's question view reads the same draft while it is typed.
    const { draft, update, clear } = useQuestionDraft(questionDraftKey(scopeKey, questionId), questions);
    // Reopening a saved draft lands on the first unanswered question; everything answered opens the last one for submit.
    const [step, setStep] = useState(() => {
        const first = questions.findIndex(q => draft.answers[q.id] !== null && !draft.answers[q.id]?.length && !draft.custom[q.id]?.trim());
        return first < 0 ? Math.max(0, questions.length - 1) : first;
    });
    // 新题从翻页方向滑入；0 = 面板刚出现，不滑动。
    const [direction, setDirection] = useState<-1 | 0 | 1>(0);
    const [picked, setPicked] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const uploads = usePrivateAttachments({ scopeKey, state: attachmentState, change: onAttachmentChange, onError: setError });
    const effective = getDraftAnswers(questions, draft);
    const answered = (q: AgentQuestion) => effective[q.id] === null || !!effective[q.id]?.length;
    const current = questions[step];
    const last = step === questions.length - 1;
    const busy = sending || disabled;

    // 卡片高度跟随当前题目：换题时从旧高度过渡到新高度，输入换行等题内变化立即跟随；超出上限才在题目区内滚动。
    useLayoutEffect(() => {
        const stage = stageRef.current, pane = paneRef.current;
        if (!stage || !pane) return;
        const sync = (animate: boolean) => {
            const height = `${pane.offsetHeight}px`;
            if (stage.style.height !== height) {
                stage.style.transition = animate ? '' : 'none';
                stage.style.height = height;
            }
            stage.toggleAttribute('data-overflow', pane.offsetHeight > parseFloat(getComputedStyle(stage).maxHeight));
        };
        sync(true);
        // 也观察题目区本身：窗口变矮时上限收紧，要及时改成可滚动。
        const observer = new ResizeObserver(() => sync(false));
        observer.observe(pane);
        observer.observe(stage);
        return () => observer.disconnect();
    }, [step, collapsed]);
    // 输入框刚被问题面板替换、焦点无处可去时，焦点交给题目，数字键即可作答。
    useEffect(() => {
        if (!document.activeElement || document.activeElement === document.body) focusTarget(paneRef.current)?.focus({ preventScroll: true });
    }, []);
    // 翻页后焦点跟到新题；触屏上不自动聚焦回答框，免得弹出键盘。
    const shownStep = useRef(step);
    useEffect(() => {
        if (shownStep.current === step) return;
        shownStep.current = step;
        const pane = paneRef.current;
        if (!pane || (document.activeElement && document.activeElement !== document.body && !pane.closest('.agent-question-dock')?.contains(document.activeElement))) return;
        const target = focusTarget(pane);
        (target instanceof HTMLTextAreaElement && matchMedia('(pointer: coarse)').matches ? pane : target)?.focus({ preventScroll: true });
    }, [step]);
    useEffect(() => () => { if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current); }, []);

    const go = (index: number) => {
        if (advanceTimer.current !== null) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
        setPicked(null); setError(null);
        if (index === step || index < 0 || index >= questions.length) return;
        setDirection(index > step ? 1 : -1);
        setStep(index);
    };
    const finish = async () => {
        if (sending || uploads.uploading || disabled) return;
        let answers: AgentAnswers;
        try { answers = validateAnswers(questions, effective); }
        catch (cause) {
            // 跳着答漏掉的题：带用户回到第一道没答的题。
            const missing = questions.findIndex(q => !answered(q));
            if (missing >= 0) go(missing);
            setError(missing >= 0 ? '这题还没回答' : cause instanceof Error ? cause.message : '回答无效');
            return;
        }
        setSending(true); setError(null);
        try { await onAnswer(formatQuestionAnswers(questions, answers), answers); clear(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '回答发送失败，请重试'); }
        finally { setSending(false); }
    };
    const advance = () => {
        if (busy || !answered(current)) return;
        if (last) void finish(); else go(step + 1);
    };
    const submit = (event: FormEvent) => { event.preventDefault(); advance(); };
    // 单选选中即翻到下一题；最后一题选中后把焦点交给提交键，回车即可提交。
    const choose = (optionId: string) => {
        update({ answers: { ...draft.answers, [current.id]: [optionId] }, custom: { ...draft.custom, [current.id]: '' } });
        setError(null); setPicked(optionId);
        if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
        const next = last ? null : step + 1;
        advanceTimer.current = window.setTimeout(() => {
            advanceTimer.current = null; setPicked(null);
            if (next === null) return;
            setDirection(1); setStep(next);
        }, ADVANCE_DELAY_MS);
        // 提交键要等这次选中渲染完才可用，下一帧再交出焦点。
        if (last) requestAnimationFrame(() => nextRef.current?.focus());
    };
    const toggle = (optionId: string) => {
        const previous = draft.answers[current.id] ?? [];
        update({ answers: { ...draft.answers, [current.id]: previous.includes(optionId) ? previous.filter(value => value !== optionId) : [...previous, optionId] }, custom: draft.custom });
        setError(null);
    };
    const pick = (optionId: string) => { if (!busy) (current.multiple ? toggle : choose)(optionId); };
    const write = (text: string) => update({ answers: { ...draft.answers, [current.id]: current.multiple ? draft.answers[current.id] ?? [] : [] }, custom: { ...draft.custom, [current.id]: text } });
    const skip = () => {
        if (busy) return;
        update({ answers: { ...draft.answers, [current.id]: null }, custom: { ...draft.custom, [current.id]: '' } });
        if (last) requestAnimationFrame(() => nextRef.current?.focus()); else go(step + 1);
    };
    const collapse = () => { if (sending) return; onCollapsedChange(true); requestAnimationFrame(() => expandRef.current?.focus()); };
    const expand = () => { onCollapsedChange(false); requestAnimationFrame(() => laterRef.current?.focus()); };
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return;
        // 先吃掉 Esc，免得对话页把它当成「停止任务」。
        if (event.key === 'Escape') { event.preventDefault(); collapse(); return; }
        const target = event.target as HTMLElement;
        const pane = paneRef.current;
        if (target instanceof HTMLTextAreaElement) {
            if (isEnter(event)) { event.preventDefault(); advance(); }
            // 「其他」框在首行按 ↑ 回到选项。
            else if (event.key === 'ArrowUp' && target.dataset.custom !== undefined && target.selectionStart === 0) {
                const options = pane?.querySelectorAll<HTMLElement>('[data-option]');
                if (options?.length) { event.preventDefault(); options[options.length - 1].focus(); }
            }
            return;
        }
        if (target === pane && isEnter(event)) { event.preventDefault(); advance(); return; }
        const options = current.options ?? [];
        if (/^[1-9]$/.test(event.key) && options[Number(event.key) - 1]) { event.preventDefault(); pick(options[Number(event.key) - 1].id); return; }
        // 方向键在选项与「其他」框之间移动；焦点在题目上时先落到已选项或首尾项。
        const arrow = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].indexOf(event.key);
        if (arrow < 0 || !pane || (target !== pane && target.dataset.option === undefined)) return;
        const items = [...pane.querySelectorAll<HTMLElement>('[data-option], [data-custom]')];
        if (!items.length) return;
        event.preventDefault();
        const forward = arrow < 2;
        if (target === pane) (pane.querySelector<HTMLElement>('[data-option][aria-checked="true"]') ?? items[forward ? 0 : items.length - 1]).focus();
        else items[(items.indexOf(target) + (forward ? 1 : items.length - 1)) % items.length].focus();
    };

    if (collapsed) {
        const done = questions.filter(answered).length;
        return <div className="agent-question-strip" role="group" aria-label="等待回答">
            <span className="agent-question-pulse" aria-hidden="true" />
            <span>{done > 0 ? <>太卜在等你回答<small> · 已答 {done}/{questions.length}</small></> : `太卜在等你回答 ${questions.length} 个问题`}</span>
            <Button unstyled type="button" className="agent-question-strip-stop" disabled={disabled} onClick={onStop}>停止任务</Button>
            <Button unstyled ref={expandRef} type="button" className="agent-question-strip-answer" onClick={expand}>{done > 0 ? '继续回答' : '回答问题'}</Button>
        </div>;
    }

    const [title, ...hintLines] = current.question.split('\n');
    const hint = hintLines.join(' ').trim();
    const options = current.options ?? [];
    const layout = optionLayout(current);
    const chosen = draft.answers[current.id] ?? [];
    const custom = draft.custom[current.id] ?? '';
    const titleId = `${id}-title`;
    const keys = options.length > 1 ? <><kbd>1</kbd>–<kbd>{Math.min(options.length, 9)}</kbd>{current.multiple ? '勾选' : '选择'}</>
        : current.allowCustom && !options.length ? <><kbd>Shift</kbd>+<kbd>Enter</kbd>换行</> : null;

    return <section className="agent-question-dock" aria-label="太卜的问题" onKeyDown={onKeyDown}>
        <header className="agent-question-head">
            <span className="agent-question-eyebrow">
                <span className="agent-question-pulse" aria-hidden="true" />
                <span>{current.header ?? (questions.length > 1 ? `第 ${step + 1} 题` : '太卜想确认')}</span>
                {/* 单选还是多选不在这里标：题干由模型写、常常自带说明，底栏的「选择 / 勾选」已经说明操作方式。 */}
                {effective[current.id] === null && <small>已跳过</small>}
            </span>
            {questions.length > 1 && <nav className="agent-question-progress" aria-label="答题进度">
                {questions.map((q, index) => {
                    const answer = describeQuestionAnswer(q, effective[q.id]);
                    const state = index === step ? 'current' : effective[q.id] === null ? 'skipped' : answer ? 'answered' : 'pending';
                    const label = `${index + 1}. ${questionLabel(q)}${answer ? `：${answer}` : ''}`;
                    return <Tooltip key={q.id} label={label}>
                        <Button unstyled type="button" className="agent-question-segment" data-state={state} aria-current={index === step ? 'step' : undefined}
                            aria-label={`第 ${index + 1} 题 ${questionLabel(q)}，${answer ?? '未回答'}`} disabled={sending} onClick={() => go(index)} />
                    </Tooltip>;
                })}
                <span className="agent-question-count" aria-hidden="true">{step + 1}/{questions.length}</span>
            </nav>}
            <Tooltip label="稍后回答 · Esc">
                <Button unstyled ref={laterRef} type="button" className="agent-question-icon" disabled={sending} onClick={collapse} aria-label="稍后回答">
                    <ChevronDown size={16} aria-hidden="true" />
                </Button>
            </Tooltip>
        </header>
        <form onSubmit={submit} noValidate>
            <div ref={stageRef} className="agent-question-stage">
                <div ref={paneRef} key={current.id} className="agent-question-pane" data-direction={direction || undefined} role="group" aria-labelledby={titleId} tabIndex={-1}>
                    <h3 id={titleId} className="agent-question-title">{title}</h3>
                    {hint && <p className="agent-question-hint">{hint}</p>}
                    {options.length > 0 && <div className={`agent-question-options${layout.chips ? ' is-chips' : ''}`} data-columns={layout.columns}
                        role={current.multiple ? 'group' : 'radiogroup'} aria-labelledby={titleId}>
                        {options.map((option, index) => {
                            const checked = chosen.includes(option.id);
                            return <Button unstyled key={option.id} type="button" data-option="" role={current.multiple ? 'checkbox' : 'radio'} aria-checked={checked} aria-label={option.label}
                                className="agent-question-option" data-picked={picked === option.id || undefined} disabled={busy}
                                tabIndex={current.multiple || checked || (!chosen.length && index === 0) ? 0 : -1} onClick={() => pick(option.id)}>
                                <span className="agent-question-key" aria-hidden="true">{checked ? <Check size={12} strokeWidth={3} /> : index < 9 ? index + 1 : '·'}</span>
                                <span className="agent-question-label">{option.label}</span>
                            </Button>;
                        })}
                    </div>}
                    {current.allowCustom && (options.length
                        ? <label className="agent-question-custom" data-filled={custom.trim() ? '' : undefined}>
                            <span className="agent-question-key" aria-hidden="true"><PenLine size={12} /></span>
                            <Textarea rows={1} data-custom="" aria-label="自行填写" value={custom} maxLength={8000} disabled={busy}
                                placeholder={current.multiple ? '还有别的，写在这里' : '都不是？直接写'} onChange={event => write(event.target.value)} />
                        </label>
                        : <Textarea className="agent-question-text" rows={2} aria-labelledby={titleId} value={custom} maxLength={8000} disabled={busy}
                            placeholder="写下你的回答…" onChange={event => write(event.target.value)} />)}
                    <PrivateAttachments items={attachmentState.uploaded} disabled={uploads.uploading || sending} onRemove={removed => onAttachmentChange({ ...attachmentState, uploaded: attachmentState.uploaded?.filter(item => item.id !== removed) })} />
                </div>
            </div>
            {error && <p className="agent-question-error" role="alert">{error}</p>}
            <footer className="agent-question-footer">
                {step > 0 && <Tooltip label="上一题">
                    <Button unstyled type="button" className="agent-question-icon" aria-label="上一题" disabled={sending} onClick={() => go(step - 1)}><ArrowLeft size={16} aria-hidden="true" /></Button>
                </Tooltip>}
                <Tooltip label={uploads.uploading ? '正在保存资料…' : '添加图片或文本资料'}>
                    <Button unstyled type="button" className="agent-question-icon" aria-label="添加图片或文本资料" disabled={busy || uploads.uploading} onClick={() => fileRef.current?.click()}>
                        {uploads.uploading ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Paperclip size={16} aria-hidden="true" />}
                    </Button>
                </Tooltip>
                <input ref={fileRef} type="file" className="hidden" tabIndex={-1} aria-hidden="true" multiple accept={PRIVATE_ATTACHMENT_ACCEPT}
                    onChange={event => { void uploads.upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
                <span className="agent-question-keys" aria-hidden="true">{keys}</span>
                {current.allowSkip && <Button unstyled type="button" className="agent-question-skip" aria-label="跳过此题" disabled={busy} onClick={skip}>跳过</Button>}
                <Button unstyled ref={nextRef} type="submit" className="agent-question-next" disabled={busy || uploads.uploading || !answered(current)}>
                    {sending && <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    {sending ? '正在发送' : last ? '提交并继续' : '下一题'}
                    {!sending && <CornerDownLeft size={13} className="agent-question-enter" aria-hidden="true" />}
                </Button>
            </footer>
        </form>
    </section>;
}
