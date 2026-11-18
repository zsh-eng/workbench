// When each kept thread's transcript last changed, as the thread holds it.
// The session stream records it (session-stream.ts), and a workspace that
// shows a thread again reads it, without loading the stream's module, to
// tell whether the thread lacks what its session showed meanwhile.

const heldAt = new Map<string, number>();

/** The thread `threadId` holds its transcript as it was at `modifiedAt`. */
export function holdSession(threadId: string, modifiedAt: number) {
  heldAt.set(threadId, modifiedAt);
}

/** The thread no longer keeps its session. */
export function dropSession(threadId: string) {
  heldAt.delete(threadId);
}

/**
 * Whether a kept thread lacks what its session showed since the thread last
 * read it: `updatedAt` is the thread list's, when the session last showed
 * something new. A thread that no one kept lacks all of it.
 */
export function sessionBehind(threadId: string, updatedAt: number) {
  const at = heldAt.get(threadId);
  return at === undefined || updatedAt > at;
}
