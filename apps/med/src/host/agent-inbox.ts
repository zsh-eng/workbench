import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { agentMessageSchema, type AgentMessage, type SentComment } from "../shared/agent-inbox";
import type { AgentSession } from "../shared/saved-review";
import { HostError } from "./runtime/errors";

/** A message as Med keeps it: what the user sees, and the text the agent gets. */
const storedMessageSchema = agentMessageSchema.extend({ body: z.string() });
type StoredMessage = z.infer<typeof storedMessageSchema>;
const MAX_MESSAGES = 100;
/** Between the messages that one prompt or one wait gives the agent. */
const BETWEEN_MESSAGES = "\n\n---\n\n";
const REVIEW_FILE = /^([A-Za-z0-9_-]+)\.json$/;
/**
 * Messages that the review sends to its agent sessions. Med sends only to a
 * session that it runs, or resumes because no other process has it open: the
 * session gets the message as its next prompt (`deliver`), or at its next
 * step while it works (`queued`, queued-messages.ts).
 */
export class AgentInbox {
  private listeners = new Map<string, Set<() => void>>();
  private writes = new Map<string, Promise<unknown>>();
  /** Each review's newest message, read once after each change. */
  private newest = new Map<string, AgentMessage | null>();
  /** Sends with a client's message ID that run now, as `review:id`. */
  private sending = new Map<string, Promise<void>>();

  constructor(
    private readonly directory: string,
    private readonly options: {
      now?: () => number;
    } = {},
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private file(reviewId: string) {
    return join(this.directory, `${reviewId}.json`);
  }

  private async read(reviewId: string): Promise<StoredMessage[]> {
    try {
      const data = JSON.parse(await readFile(this.file(reviewId), "utf8")) as unknown;
      return z.object({ messages: z.array(storedMessageSchema) }).parse(data).messages;
    } catch {
      return [];
    }
  }

  /** Runs changes to one review's messages one after another. */
  private change<T>(reviewId: string, work: (messages: StoredMessage[]) => Promise<T> | T) {
    const previous = this.writes.get(reviewId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const messages = await this.read(reviewId);
        const result = await work(messages);
        await mkdir(this.directory, { recursive: true });
        const temporary = join(this.directory, `.${reviewId}-${randomUUID()}.tmp`);
        await writeFile(
          temporary,
          JSON.stringify({ messages: messages.slice(-MAX_MESSAGES) }),
          "utf8",
        );
        await rename(temporary, this.file(reviewId));
        return result;
      });
    this.writes.set(reviewId, next);
    return next.finally(() => {
      if (this.writes.get(reviewId) === next) this.writes.delete(reviewId);
      this.newest.delete(reviewId);
      this.notify(reviewId);
    });
  }

  /** Tells listeners that the review's comments changed, so drafts change. */
  touch(reviewId: string) {
    this.notify(reviewId);
  }

  private notify(reviewId: string) {
    for (const listener of this.listeners.get(reviewId) ?? []) listener();
  }

  subscribe(reviewId: string, listener: () => void) {
    const set = this.listeners.get(reviewId) ?? new Set();
    set.add(listener);
    this.listeners.set(reviewId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(reviewId);
    };
  }

  async messages(reviewId: string): Promise<AgentMessage[]> {
    await this.writes.get(reviewId)?.catch(() => {});
    return (await this.read(reviewId)).map(({ body: _body, ...message }) => message);
  }

  /** The review's newest message, for the thread list; it reads the file
   * only after a change. */
  async last(reviewId: string): Promise<AgentMessage | undefined> {
    if (!this.newest.has(reviewId)) {
      if (this.newest.size > 512) this.newest.clear();
      this.newest.set(reviewId, (await this.messages(reviewId)).at(-1) ?? null);
    }
    return this.newest.get(reviewId) ?? undefined;
  }

  /** Whether a message to the session waits for delivery. */
  async pending(reviewId: string, sessionId: string) {
    return (await this.messages(reviewId)).some(
      (message) => message.sessionId === sessionId && message.delivery === "pending",
    );
  }

  /**
   * Takes back a queued message that the agent has not had: it leaves the
   * review, and its comments are drafts again. Returns it, for the user to
   * edit; a message that went already cannot come back. Its attached
   * selections and images stay out of it: the box gets its text again.
   */
  takeBack(reviewId: string, id: string): Promise<AgentMessage> {
    return this.change(reviewId, (messages) => {
      const index = messages.findIndex((message) => message.id === id);
      const message = messages[index];
      if (!message?.queued || message.delivery !== "pending")
        throw new HostError(
          "message-sent",
          "The agent has this message already, so it cannot come back.",
          409,
        );
      messages.splice(index, 1);
      const { body: _body, ...taken } = message;
      return taken;
    });
  }

  /**
   * Send now on a queued message: it waits for the agent's next step, not
   * its turn's end. Returns it; one that went already is an error.
   */
  sendNow(reviewId: string, id: string): Promise<AgentMessage> {
    return this.change(reviewId, (messages) => {
      const message = messages.find((entry) => entry.id === id);
      if (!message?.queued || message.delivery !== "pending")
        throw new HostError("message-gone", "The agent has this message already.", 409);
      delete message.afterTurn;
      const { body: _body, ...shown } = message;
      return shown;
    });
  }

  /** The sessions whose messages wait for the agent's next step, in every
   * review, as Med kept them before it restarted. */
  queued(): Promise<{ reviewId: string; sessionId: string }[]> {
    return this.sessionsWith((message) => !!message.queued);
  }

  private async sessionsWith(
    test: (message: StoredMessage) => boolean,
  ): Promise<{ reviewId: string; sessionId: string }[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }
    const found: { reviewId: string; sessionId: string }[] = [];
    for (const name of names) {
      const reviewId = REVIEW_FILE.exec(name)?.[1];
      if (!reviewId) continue;
      const sessions = new Set(
        (await this.read(reviewId))
          .filter((message) => test(message) && message.delivery === "pending")
          .map((message) => message.sessionId),
      );
      for (const sessionId of sessions) found.push({ reviewId, sessionId });
    }
    return found;
  }

  /**
   * Gives the session's pending messages, in order, to `deliver` as one
   * prompt, such as to a Claude session that Med resumes. With `to`, they go
   * to that session instead, such as a fork that continues the work. Returns
   * how many it gave, and how many still wait.
   */
  deliverPending(
    reviewId: string,
    sessionId: string,
    deliver: (body: string) => Promise<void>,
    to?: AgentSession,
    /** During the agent's turn: only the messages that `only` picks, and
     * none once `when` no longer holds, as when the turn ended meanwhile. */
    during?: { only(message: AgentMessage): boolean; when(): boolean },
  ) {
    return this.change(reviewId, async (messages) => {
      const waiting = messages.filter(
        (message) => message.sessionId === sessionId && message.delivery === "pending",
      );
      if (during && !during.when()) return { delivered: 0, left: waiting.length };
      const due = waiting.filter((message) => !during || during.only(message));
      if (!due.length) return { delivered: 0, left: waiting.length };
      let error: string | undefined;
      try {
        await deliver(due.map((message) => message.body).join(BETWEEN_MESSAGES));
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
      const at = new Date(this.now()).toISOString();
      for (const message of due) {
        delete message.queued;
        delete message.afterTurn;
        if (to) {
          message.sessionId = to.id;
          message.agent = to.agent;
        }
        if (error) {
          message.delivery = "failed";
          message.error = error;
        } else {
          message.delivery = "delivered";
          message.deliveredAt = at;
        }
      }
      return { delivered: error ? 0 : due.length, left: waiting.length - due.length };
    });
  }

  /** Moves a thread's messages to another thread, after those it has, as
   * when Med continues a session in a fork that takes its thread's place. */
  async move(from: string, to: string) {
    if (from === to) return;
    const moved = await this.change(from, (messages) => messages.splice(0));
    if (moved.length) await this.change(to, (messages) => void messages.unshift(...moved));
  }

  /**
   * Runs `send` for the message with the client's ID `id`, one at a time. A
   * message that Med has already comes back, and `send` does not run, so a
   * message sent again, as from two windows that reload, goes once.
   */
  async once(
    reviewId: string,
    id: string | undefined,
    send: () => Promise<AgentMessage>,
  ): Promise<AgentMessage> {
    if (!id) return send();
    const key = `${reviewId}:${id}`;
    for (let running = this.sending.get(key); running; running = this.sending.get(key))
      await running;
    let done!: () => void;
    this.sending.set(key, new Promise<void>((resolve) => (done = resolve)));
    try {
      return (await this.messages(reviewId)).find((entry) => entry.id === id) ?? (await send());
    } finally {
      this.sending.delete(key);
      done();
    }
  }

  async send(
    reviewId: string,
    session: AgentSession,
    message: {
      /** The client's ID; a message with this ID is not sent again. */
      id?: string;
      text: string;
      noteIds: string[];
      comments?: SentComment[];
      noteVersions?: Record<string, string>;
      attachmentCount: number;
      imageCount?: number;
    },
    body: string,
    route: {
      /** Sends to a session that Med runs, as its next prompt, with the
       * session's messages that wait before it. */
      deliver?: (body: string) => Promise<void>;
      /** The session that Med runs works: the message waits for its next
       * step (queued-messages.ts), and the user can take it back. */
      queued?: boolean;
      /** With `queued`: it waits for the turn's end instead (Queue). */
      afterTurn?: boolean;
    } = {},
  ): Promise<AgentMessage> {
    if (message.id) {
      const sent = (await this.messages(reviewId)).find((entry) => entry.id === message.id);
      if (sent) return sent;
    }
    const stored: StoredMessage = {
      id: message.id ?? randomUUID(),
      sessionId: session.id,
      agent: session.agent,
      text: message.text,
      noteIds: message.noteIds,
      ...(message.comments?.length ? { comments: message.comments } : {}),
      ...(message.noteVersions && Object.keys(message.noteVersions).length
        ? { noteVersions: message.noteVersions }
        : {}),
      attachmentCount: message.attachmentCount,
      ...(message.imageCount ? { imageCount: message.imageCount } : {}),
      createdAt: new Date(this.now()).toISOString(),
      delivery: "pending",
      body,
      ...(route.queued ? { queued: true } : {}),
      ...(route.queued && route.afterTurn ? { afterTurn: true } : {}),
    };
    const { deliver } = route;
    if (deliver) {
      // The messages that waited go first, in the same prompt, and only once:
      // the change holds the review's messages while the agent takes them.
      await this.change(reviewId, async (messages) => {
        const earlier = messages.filter(
          (entry) => entry.sessionId === session.id && entry.delivery === "pending",
        );
        try {
          await deliver([...earlier.map((entry) => entry.body), body].join(BETWEEN_MESSAGES));
          const at = new Date(this.now()).toISOString();
          for (const entry of [...earlier, stored]) {
            delete entry.queued;
            delete entry.afterTurn;
            entry.delivery = "delivered";
            entry.deliveredAt = at;
          }
        } catch (error) {
          stored.delivery = "failed";
          stored.error = error instanceof Error ? error.message : String(error);
        }
        messages.push(stored);
      });
    }
    if (!deliver)
      await this.change(reviewId, (messages) => {
        messages.push(stored);
      });
    const { body: _body, ...result } =
      (await this.read(reviewId)).find((entry) => entry.id === stored.id) ?? stored;
    return result;
  }
}
