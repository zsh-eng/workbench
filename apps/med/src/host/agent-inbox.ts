import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { agentMessageSchema, type AgentMessage } from "../shared/agent-inbox";
import type { AgentSession } from "../shared/saved-review";
import { HostError } from "./runtime/errors";

/** A message as Med keeps it: what the user sees, and the text the agent gets. */
const storedMessageSchema = agentMessageSchema.extend({ body: z.string() });
type StoredMessage = z.infer<typeof storedMessageSchema>;
const MAX_MESSAGES = 100;
/** A `med review wait` that ends its poll still counts as waiting while it polls again. */
const WAIT_GRACE_MS = 5_000;
/** `codex queue` takes the message as an argument, which the system limits. */
const MAX_CODEX_MESSAGE_BYTES = 200_000;

type WaitResult = { body: string } | { superseded: true } | null;
interface Waiter {
  /** False when the wait already ended, such as after its time ran out. */
  resolve(result: WaitResult): boolean;
}

/**
 * Messages that the review sends to its agent sessions. A Claude session
 * takes them with `med review wait`, a long poll that ends when a message
 * arrives. A Codex session gets them from its own queue (`codex queue`), which
 * the next Codex process for the thread reads first.
 */
export class AgentInbox {
  private waiters = new Map<string, Waiter>();
  private polled = new Map<string, number>();
  private listeners = new Map<string, Set<() => void>>();
  private writes = new Map<string, Promise<unknown>>();

  constructor(
    private readonly directory: string,
    private readonly options: {
      queueCodex?: (threadId: string, text: string) => Promise<void>;
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

  /** Sessions whose agent waits for a message now. */
  waiting(reviewId: string): string[] {
    const prefix = `${reviewId}:`;
    const now = this.now();
    const sessions = new Set<string>();
    for (const key of this.waiters.keys()) if (key.startsWith(prefix)) sessions.add(key);
    for (const [key, at] of this.polled)
      if (key.startsWith(prefix) && now - at < WAIT_GRACE_MS) sessions.add(key);
    return [...sessions].map((key) => key.slice(prefix.length));
  }

  async send(
    reviewId: string,
    session: AgentSession,
    message: { text: string; noteIds: string[]; attachmentCount: number },
    body: string,
  ): Promise<AgentMessage> {
    const stored: StoredMessage = {
      id: randomUUID(),
      sessionId: session.id,
      agent: session.agent,
      text: message.text,
      noteIds: message.noteIds,
      attachmentCount: message.attachmentCount,
      createdAt: new Date(this.now()).toISOString(),
      delivery: "pending",
      body,
    };
    if (session.agent === "codex") {
      try {
        if (Buffer.byteLength(body) > MAX_CODEX_MESSAGE_BYTES)
          throw new Error("The message is too long for codex queue. Send fewer comments.");
        await (this.options.queueCodex ?? queueCodexMessage)(session.id, body);
        stored.delivery = "queued";
        stored.deliveredAt = new Date(this.now()).toISOString();
      } catch (error) {
        stored.delivery = "failed";
        stored.error = error instanceof Error ? error.message : String(error);
      }
    }
    await this.change(reviewId, (messages) => {
      messages.push(stored);
    });
    if (session.agent === "claude") await this.offer(reviewId, session.id);
    const { body: _body, ...result } =
      (await this.read(reviewId)).find((entry) => entry.id === stored.id) ?? stored;
    return result;
  }

  /** Gives pending messages to a waiting agent, if one waits. */
  private async offer(reviewId: string, sessionId: string) {
    const key = this.waiters.has(`${reviewId}:${sessionId}`)
      ? `${reviewId}:${sessionId}`
      : this.waiters.has(`${reviewId}:*`)
        ? `${reviewId}:*`
        : undefined;
    if (!key) return;
    const waiter = this.waiters.get(key)!;
    const taken = await this.take(reviewId, key.endsWith(":*") ? undefined : sessionId);
    if (!taken) return;
    // The wait ended while Med read the messages: keep them for the next one.
    if (!waiter.resolve({ body: taken.body }))
      await this.change(reviewId, (messages) => {
        for (const message of messages)
          if (taken.ids.includes(message.id)) {
            message.delivery = "pending";
            delete message.deliveredAt;
          }
      });
  }

  /** Marks the pending messages for a session delivered and joins their text. */
  private take(reviewId: string, sessionId: string | undefined) {
    return this.change(reviewId, (messages) => {
      const pending = messages.filter(
        (message) =>
          message.delivery === "pending" &&
          message.agent === "claude" &&
          (!sessionId || message.sessionId === sessionId),
      );
      if (!pending.length) return undefined;
      const at = new Date(this.now()).toISOString();
      for (const message of pending) {
        message.delivery = "delivered";
        message.deliveredAt = at;
      }
      return {
        ids: pending.map((message) => message.id),
        body: pending.map((message) => message.body).join("\n\n---\n\n"),
      };
    });
  }

  /**
   * Waits up to `timeout` for a message to a session, or to any Claude session
   * of the review without `sessionId`. A newer wait for the same session ends
   * an older one.
   */
  async wait(
    reviewId: string,
    sessionId: string | undefined,
    timeout: number,
    signal: AbortSignal,
  ): Promise<WaitResult> {
    const key = `${reviewId}:${sessionId ?? "*"}`;
    const pending = await this.take(reviewId, sessionId);
    if (pending) return { body: pending.body };
    this.waiters.get(key)?.resolve({ superseded: true });
    return new Promise((resolve) => {
      let done = false;
      const finish = (result: WaitResult) => {
        if (done) return false;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        if (this.waiters.get(key) === waiter) this.waiters.delete(key);
        if (result === null) {
          this.polled.set(key, this.now());
          // The grace period ends without another poll: tell the page.
          setTimeout(() => this.notify(reviewId), WAIT_GRACE_MS + 50).unref?.();
        } else this.polled.delete(key);
        this.notify(reviewId);
        resolve(result);
        return true;
      };
      const waiter: Waiter = { resolve: finish };
      const stop = () => finish(null);
      const timer = setTimeout(stop, timeout);
      signal.addEventListener("abort", stop, { once: true });
      this.waiters.set(key, waiter);
      this.notify(reviewId);
    });
  }
}

/** Codex's CLI: MED_CODEX_PATH, `codex` on the PATH, or the one in the ChatGPT app. */
export async function findCodex(environment: NodeJS.ProcessEnv = process.env) {
  const candidates = [
    environment.MED_CODEX_PATH,
    ...(environment.PATH ?? "")
      .split(delimiter)
      .map((directory) => directory && join(directory, "codex")),
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
  ].filter((path): path is string => !!path);
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Try the next place.
    }
  }
  return undefined;
}

/** Adds a user message to a Codex thread's queue. */
export async function queueCodexMessage(threadId: string, text: string) {
  const codex = await findCodex();
  if (!codex)
    throw new HostError(
      "codex-not-found",
      "Med could not find the codex command. Install Codex, or set MED_CODEX_PATH.",
      409,
    );
  await new Promise<void>((resolve, reject) =>
    execFile(
      codex,
      ["queue", "--thread", threadId, "--message", text],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) =>
        error
          ? reject(
              new Error(`codex queue failed: ${(stderr || error.message).trim().slice(0, 500)}`),
            )
          : resolve(),
    ),
  );
}
