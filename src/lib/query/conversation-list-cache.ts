import type { QueryClient } from '@tanstack/react-query';
import type { ConversationListItem } from '@/types';
import { queryKeys } from '@/lib/query/keys';

export const EMPTY_CONVERSATIONS: ConversationListItem[] = [];

type ConversationListUpdate = ConversationListItem[]
  | ((current: ConversationListItem[]) => ConversationListItem[]);

/** Query owns the only list. Context still owns request/window orchestration. */
export function createConversationListCache(
  queryClient: QueryClient,
  userId: string | null,
  isCurrentScope: () => boolean,
) {
  const queryKey = queryKeys.conversationList(userId);
  const isCurrent = () => userId !== null && isCurrentScope();
  const read = (): ConversationListItem[] => isCurrent()
    ? queryClient.getQueryData<ConversationListItem[]>(queryKey) ?? EMPTY_CONVERSATIONS
    : EMPTY_CONVERSATIONS;
  const update = (next: ConversationListUpdate) => {
    if (!isCurrent()) return;
    queryClient.setQueryData<ConversationListItem[]>(queryKey, (current = EMPTY_CONVERSATIONS) => (
      typeof next === 'function' ? next(current) : next
    ));
  };

  return {
    queryKey,
    read,
    update,
    isCurrent,
    clear: () => queryClient.removeQueries({ queryKey, exact: true }),
    // Preserve the stream/controller ref API without a second writable array.
    ref: {
      get current() { return read(); },
      set current(value: ConversationListItem[]) { update(value); },
    },
  };
}
