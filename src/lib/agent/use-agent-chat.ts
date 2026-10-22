"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAttachment, ChatMessage, CustomProviderConfig, Mention } from "@/types";
import type { ChatStateReturn } from "@/lib/chat/use-chat-state";
import {
  agentJson,
  mergeAgentSnapshot,
  readAgentStream,
  canAdoptAgentRun,
  postAgentRun,
  postAgentCommand,
  AgentHttpError,
} from "./browser-client";
import { isAgentRunTerminal, type AgentRunView } from "./types";
import { useNextTaskConfiguration } from '@/lib/chat/use-next-task-configuration';

type AgentCapabilities = {
  enabled: boolean;
  ready: boolean;
  webAvailable: boolean;
  /** Plain chat can search the web; reported here because every chat already polls this status. */
  plainWebAvailable: boolean;
  customAvailable: boolean;
};
const NO_CAPABILITIES: AgentCapabilities = {
  enabled: false,
  ready: false,
  webAvailable: false,
  plainWebAvailable: false,
  customAvailable: false,
};
type AgentCommandRequest = Parameters<typeof postAgentCommand>[1];
export function useAgentChat(
  state: ChatStateReturn,
  userId: string | null,
  refreshViewer: () => Promise<unknown>,
) {
  const [mode, setModeState] = useState<"agent" | "plain">("plain");
  const [capabilities, setCapabilities] = useState<AgentCapabilities>(NO_CAPABILITIES);
  const [run, setRun] = useState<AgentRunView | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [syncingRunId, setSyncingRunId] = useState<string | null>(null);
  const [webEnabled, setWebEnabled] = useState(true);
  const [codeMode, setCodeMode] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  useNextTaskConfiguration(userId, state.activeConversationId, { model: state.selectedModel, reasoning: state.reasoningEnabled, reasoningEffort: state.reasoningEffort, collaborators: state.collaborators, webEnabled, codeMode, planMode }, value => {
    state.setSelectedModel(value.model); state.setReasoningEnabled(value.reasoning); state.setReasoningEffort(value.reasoningEffort); state.setCollaborators(value.collaborators); setWebEnabled(value.webEnabled); setCodeMode(value.codeMode); setPlanMode(value.planMode);
  });
  const identity = useRef({ userId, epoch: 0 });
  if (identity.current.userId !== userId) {
    identity.current = { userId, epoch: identity.current.epoch + 1 };
  }
  const ownerEpoch = identity.current.epoch;
  const latest = useRef({ state, refreshViewer, userId });
  latest.current = { state, refreshViewer, userId };
  const explicitMode = useRef(false);
  const completed = useRef(new Set<string>());
  const receivedCursors = useRef(new Map<string, number>());
  const latestRuns = useRef(new Map<string, AgentRunView>());
  const pendingCreations = useRef(
    new Map<string, { key: string; body: Record<string, unknown> }>(),
  );
  const pendingCommands = useRef(new Map<string, AgentCommandRequest>());
  const captureConversation = useCallback((conversationId = latest.current.state.activeConversationIdRef.current) => {
    const owner = latest.current.userId;
    const epoch = identity.current.epoch;
    const selection = latest.current.state.conversationEpochRef.current;
    return () => owner !== null && latest.current.userId === owner && identity.current.epoch === epoch &&
      latest.current.state.activeConversationIdRef.current === conversationId &&
      latest.current.state.conversationEpochRef.current === selection;
  }, []);
  const adopt = useCallback((view: AgentRunView) => {
    if (
      view.conversationId !==
      latest.current.state.activeConversationIdRef.current
    )
      return;
    if ((receivedCursors.current.get(view.id) ?? -1) > view.cursor) return;
    if (!canAdoptAgentRun(latestRuns.current.get(view.conversationId), view))
      return;
    latestRuns.current.set(view.conversationId, view);
    receivedCursors.current.set(view.id, view.cursor);
    setRun((current) =>
      current?.id === view.id && current.cursor > view.cursor ? current : view,
    );
    latest.current.state.setMessages((messages) =>
      mergeAgentSnapshot(messages, view),
    );
    if (isAgentRunTerminal(view.status) && !completed.current.has(view.id)) {
      completed.current.add(view.id);
      setSyncingRunId(view.id);
      void latest.current.refreshViewer();
      void latest.current.state.refreshConversationList();
      void latest.current.state
        .retryConversationLoad()
        .finally(() =>
          setSyncingRunId((current) => (current === view.id ? null : current)),
        )
        .catch(() => {});
    }
  }, []);
  useEffect(() => {
    pendingCreations.current.clear();
    pendingCommands.current.clear();
    if (!userId) return;
    receivedCursors.current.clear();
    latestRuns.current.clear();
    completed.current.clear();
    explicitMode.current = false;
    try {
      const saved = localStorage.getItem(`taibu:agent-mode:${userId}`);
      if (saved === "agent" || saved === "plain") {
        explicitMode.current = true;
        setModeState(saved);
      }
    } catch {}
    const controller = new AbortController();
    const load = async () => {
      try {
        const value = await agentJson<AgentCapabilities>("/api/agent/status", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCapabilities(value);
        if (!explicitMode.current)
          setModeState(value.ready ? "agent" : "plain");
      } catch {
        if (!controller.signal.aborted) setCapabilities(NO_CAPABILITIES);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      controller.abort();
      clearInterval(timer);
      setRun(null);
    };
  }, [userId]);
  useEffect(() => {
    setRun(null);
    if (!userId || !state.activeConversationId || state.conversationLoading) {
      setRestoring(false);
      return;
    }
    setRestoring(true);
    const isCurrent = captureConversation();
    const controller = new AbortController();
    void agentJson<AgentRunView | null>(
      `/api/agent/runs?conversationId=${encodeURIComponent(state.activeConversationId)}`,
      { signal: controller.signal },
    )
      .then((view) => {
        if (view && !controller.signal.aborted && isCurrent()) adopt(view);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted && isCurrent()) setRestoring(false);
      });
    return () => controller.abort();
  }, [adopt, captureConversation, userId, state.activeConversationId, state.conversationLoading]);
  const runId = run?.id;
  useEffect(() => {
    if (
      !runId ||
      !run ||
      isAgentRunTerminal(run.status)
    )
      return;
    const controller = new AbortController();
    const isCurrent = captureConversation();
    let cursor = run.cursor;
    let epoch = run.epoch;
    const listen = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(
            `/api/agent/runs/${runId}/events?after=${cursor}${epoch === undefined ? '' : `&epoch=${epoch}`}`,
            { signal: controller.signal },
          );
          if (isCurrent()) setReconnecting(false);
          let settled = false;
          await readAgentStream(response, controller.signal, (view) => {
            cursor = Math.max(cursor, view.cursor);
            epoch = view.epoch;
            if (isCurrent()) adopt(view);
            settled = isAgentRunTerminal(view.status);
          }, resync => { if (resync.runId === runId) { cursor = resync.cursor; epoch = resync.epoch; } });
          if (settled) return;
        } catch {
          if (controller.signal.aborted) return;
          if (isCurrent()) setReconnecting(true);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    };
    void listen();
    return () => controller.abort();
    // Snapshots update the same connection; only task/status transitions resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, run?.status, adopt, captureConversation]);

  const setMode = useCallback(
    (value: "agent" | "plain") => {
      explicitMode.current = true;
      setModeState(value);
      if (userId)
        try {
          localStorage.setItem(`taibu:agent-mode:${userId}`, value);
        } catch {}
    },
    [userId],
  );
  const start = async (
    conversationId: string,
    message: ChatMessage,
    options: {
      model: string;
      reasoning: boolean;
      mentions: Mention[];
      provider: CustomProviderConfig | null;
      attachment?: ChatAttachment;
      replaceFromMessageId?: string;
    },
  ) => {
    const isOwner = () => latest.current.userId === userId && identity.current.epoch === ownerEpoch;
    if (!userId || !isOwner()) throw new Error("登录状态已变更，请重新发送");
    const isCurrent = captureConversation(conversationId);
    if (options.provider && !capabilities.customAvailable)
      throw new Error("自定义模型后台任务未配置，可切换普通对话");
    const body: Record<string, unknown> = {
      conversationId,
      clientRequestId: crypto.randomUUID(),
      message,
      model: options.model,
      reasoning: options.reasoning,
      reasoningEffort: state.reasoningEffort,
      collaborators: options.provider ? [] : state.collaborators,
      mentions: options.mentions,
      attachment: options.attachment,
      replaceFromMessageId: options.replaceFromMessageId,
      customProvider: options.provider
        ? {
            apiUrl: options.provider.apiUrl,
            apiKey: options.provider.apiKey,
            modelId: options.provider.modelId,
          }
        : undefined,
      webEnabled,
      codeMode,
      planMode,
      dreamMode: state.chatMode === "dream",
      mangpaiMode: state.chatMode === "mangpai",
    };
    const key = JSON.stringify({
      ...body,
      clientRequestId: undefined,
      message: { content: message.content, attachments: message.attachments },
    });
    const pending = pendingCreations.current.get(conversationId);
    const requestBody = pending?.key === key ? pending.body : body;
    pendingCreations.current.set(conversationId, { key, body: requestBody });
    const forget = () => {
      if (pendingCreations.current.get(conversationId)?.body === requestBody)
        pendingCreations.current.delete(conversationId);
    };
    let view: AgentRunView;
    try {
      view = await postAgentRun(requestBody);
    } catch (error) {
      if (
        error instanceof AgentHttpError &&
        error.status >= 400 &&
        error.status < 500
      )
        forget();
      else {
        if (!isOwner()) throw error;
        const recovered = await agentJson<AgentRunView | null>(
          `/api/agent/runs?conversationId=${encodeURIComponent(conversationId)}`,
        ).catch(() => null);
        if (recovered && recovered.clientRequestId === requestBody.clientRequestId) {
          forget();
          if (isCurrent()) {
            adopt(recovered);
            void latest.current.state.retryConversationLoad();
          }
          return recovered;
        }
      }
      throw error;
    }
    forget();
    if (isCurrent() && canAdoptAgentRun(latestRuns.current.get(conversationId), view) && view.userMessage)
      latest.current.state.setMessages((messages) =>
        messages.map((current) =>
          current.id === message.id
            ? {
                ...current,
                ...view.userMessage,
                versions: current.versions,
                currentVersionIndex: current.currentVersionIndex,
              }
            : current,
        ),
      );
    if (isCurrent()) adopt(view);
    if (isOwner()) {
      void latest.current.refreshViewer();
      void latest.current.state.refreshConversationList();
    }
    return view;
  };
  const active = !!run && !isAgentRunTerminal(run.status);
  const sendCommand = async (content: string, queue = false, structured?: { questionId: string; answers: import('./questions').AgentAnswers }) => {
    if (!run || !active) throw new Error("任务已结束");
    const isCurrent = captureConversation(run.conversationId);
    if (!userId || identity.current.epoch !== ownerEpoch || !isCurrent())
      throw new Error("对话或登录状态已变更，请重新发送");
    // The task can resume while a reply's HTTP receipt is lost. Retain its
    // original mode as well as its ID, even if the observed status has changed.
    const attachmentIds=latest.current.state.attachmentState.uploaded?.map(item=>item.id);
    const key = JSON.stringify([run.id, content, queue, structured,attachmentIds]);
    const body: AgentCommandRequest = pendingCommands.current.get(key) ?? {
      content, clientRequestId: crypto.randomUUID(),
      mode: run.status === "awaiting_input" ? "reply" : queue ? "follow_up" : "steer",
      ...structured,
      attachmentIds,
    };
    pendingCommands.current.set(key, body);
    const forget = () => {
      if (pendingCommands.current.get(key) === body) pendingCommands.current.delete(key);
    };
    try {
      const result = await postAgentCommand(run.id, body);
      forget();
      if (isCurrent() && canAdoptAgentRun(latestRuns.current.get(run.conversationId), result.run)) {
        latest.current.state.setMessages((messages) =>
          messages.some((m) => m.id === result.message.id) ? messages : [...messages, result.message],
        );
        adopt(result.run);
      }
    } catch (error) {
      if (error instanceof AgentHttpError && error.status >= 400 && error.status < 500) forget();
      throw error;
    }
  };
  const stop = () => {
    const isCurrent = captureConversation(run?.conversationId);
    if (run && identity.current.epoch === ownerEpoch && isCurrent())
      void agentJson<AgentRunView>(`/api/agent/runs/${run.id}/cancel`, {
        method: "POST",
      })
        .then(view => { if (isCurrent()) adopt(view); })
        .catch(() => { if (isCurrent()) setReconnecting(true); });
  };
  return {
    mode,
    setMode,
    capabilities,
    run,
    active,
    reconnecting,
    restoring,
    syncing:
      !!syncingRunId &&
      latestRuns.current.get(state.activeConversationId ?? "")?.id ===
        syncingRunId,
    start,
    sendCommand,
    captureConversation,
    stop,
    webEnabled,
    setWebEnabled,
    codeMode,
    setCodeMode,
    planMode,
    setPlanMode,
    running: active && run?.status !== "awaiting_input",
  };
}
