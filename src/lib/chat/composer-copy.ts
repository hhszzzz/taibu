/** Composer wording that follows the conversation state, kept pure so each state's copy is tested. */
export interface ComposerNoteState {
    agentMode: boolean;
    /** Agent tasks cannot start here (no worker or capability configured). */
    agentUnavailable?: boolean;
    reconnecting?: boolean;
    /** A task of this conversation waits for answers. */
    awaiting?: boolean;
    /** A task of this conversation is queued or executing. */
    running?: boolean;
    /** Members of the running task's frozen collaboration, 0 when it runs alone. */
    collaborators?: number;
}

/** One-line note under the composer. */
export function composerNote(state: ComposerNoteState): string {
    if (!state.agentMode) return '普通对话不调用工具 · 需要排盘或检索时切换到 Agent';
    if (state.agentUnavailable) return '后台任务暂不可用，可切换到普通对话';
    if (state.reconnecting) return '正在重新连接任务 · 后台仍在执行';
    if (state.awaiting) return '也可以在对话里直接回答 · 等待期间不会超时，也不会再次扣费';
    if (state.running) return state.collaborators
        ? '协作配置在任务创建时冻结 · 修改将用于下一项任务 · 整项任务只计费一次'
        : '后台执行中，关闭页面也会继续 · 补充内容在下一个安全步骤生效';
    return '解读仅供参考 · 排盘与计算由太卜 Core 完成';
}

/**
 * The note while a task runs restates the header's task status, so phones leave it out
 * (design board "手机 · 任务对话"); notices about an unavailable or reconnecting task stay.
 */
export function isRunningComposerNote(state: ComposerNoteState): boolean {
    return state.agentMode && !state.agentUnavailable && !state.reconnecting && !state.awaiting && !!state.running;
}
