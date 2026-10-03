import type { QueryClient } from '@tanstack/react-query';
import type { ConversationListItem } from '@/types';
import { queryKeys } from '@/lib/query/keys';

export const EMPTY_CONVERSATIONS: ConversationListItem[] = [];

type ConversationListUpdate = ConversationListItem[]
  | ((current: ConversationListItem[]) => ConversationListItem[]);

type ConversationMutation = {
  id: string;
  previous: ConversationListItem;
} & (
  | { kind: 'rename'; title: string }
  | { kind: 'delete'; index: number; nextId?: string }
);

/** Query owns the only list. Context still owns request/window orchestration. */
export function createConversationListCache(
  queryClient: QueryClient,
  userId: string | null,
  isCurrentScope: () => boolean,
) {
  const queryKey = queryKeys.conversationList(userId);
  const pending = new Map<string, ConversationMutation>();
  const isCurrent = () => userId !== null && isCurrentScope();
  const read = (): ConversationListItem[] => isCurrent()
    ? queryClient.getQueryData<ConversationListItem[]>(queryKey) ?? EMPTY_CONVERSATIONS
    : EMPTY_CONVERSATIONS;
  const update = (next: ConversationListUpdate) => {
    if (!isCurrent()) return;
    queryClient.setQueryData<ConversationListItem[]>(queryKey, (current = EMPTY_CONVERSATIONS) => {
      const rows = typeof next === 'function' ? next(current) : next;
      if (pending.size === 0) return rows;
      return rows.flatMap(row => {
        const operation = pending.get(row.id);
        if (operation?.kind === 'delete') return [];
        return [operation?.kind === 'rename' ? { ...row, title: operation.title } : row];
      });
    });
  };
  const beginRename = (id: string, title: string) => {
    const previous = read().find(row => row.id === id);
    if (!previous || pending.has(id)) return null;
    const operation: ConversationMutation = { kind: 'rename', id, previous, title };
    pending.set(id, operation);
    update(current => current);
    return operation;
  };
  const beginDelete = (id: string) => {
    const rows = read();
    const index = rows.findIndex(row => row.id === id);
    if (index < 0 || pending.has(id)) return null;
    const operation: ConversationMutation = {
      kind: 'delete', id, previous: rows[index], index, nextId: rows[index + 1]?.id,
    };
    pending.set(id, operation);
    update(current => current);
    return operation;
  };
  const settle = (operation: ConversationMutation, success: boolean) => {
    if (!isCurrent() || pending.get(operation.id) !== operation) return false;
    pending.delete(operation.id);
    if (!success) {
      update(current => {
        if (operation.kind === 'rename') {
          return current.map(row => row.id === operation.id && row.title === operation.title
            ? { ...row, title: operation.previous.title }
            : row);
        }
        if (current.some(row => row.id === operation.id)) return current;
        const nextIndex = current.findIndex(row => row.id === operation.nextId);
        const index = nextIndex < 0 ? Math.min(operation.index, current.length) : nextIndex;
        return [...current.slice(0, index), operation.previous, ...current.slice(index)];
      });
    }
    return true;
  };

  return {
    queryKey,
    read,
    update,
    isCurrent,
    beginRename,
    beginDelete,
    settle,
    cancelMutation: (id: string) => {
      const operation = pending.get(id);
      pending.delete(id);
      return operation;
    },
    clear: () => {
      pending.clear();
      queryClient.removeQueries({ queryKey, exact: true });
    },
    // Preserve the stream/controller ref API without a second writable array.
    ref: {
      get current() { return read(); },
      set current(value: ConversationListItem[]) { update(value); },
    },
  };
}
