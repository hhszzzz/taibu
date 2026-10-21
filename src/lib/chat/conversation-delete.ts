import type { ScopedDb } from '@/lib/db/context.server';

function normalizeError(error: unknown) {
  if (!error) return null;
  const message = (error as { message?: unknown }).message;
  return { message: typeof message === 'string' ? message : 'Unknown error' };
}

export async function deleteConversationGraph(
  db: ScopedDb,
  conversationId: string,
) {
  try {
    const deleted = await db.rpc('delete_conversation_graph', {
      p_conversation_id: conversationId,
    });
    return { error: null, notFound: deleted === false };
  } catch (error) {
    return { error: normalizeError(error), notFound: false };
  }
}
