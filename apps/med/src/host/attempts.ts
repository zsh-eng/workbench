import { existsSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { SessionEvent, ToolCallContent } from "../shared/agent-session";
import {
  attemptLetter,
  attemptRoutes,
  modelName,
  type Attempt,
  type AttemptCheck,
  type AttemptCompare,
  type AttemptFile,
  type AttemptFileChange,
  type AttemptKept,
  type AttemptUndo,
} from "../shared/attempts";
import type { RegisteredRepository } from "../shared/protocol";
import {
  agentName,
  threadCheckout,
  type AgentSession,
  type SavedReview,
} from "../shared/saved-review";
import { findTranscript, readTranscriptPage, transcriptTurns } from "./agent-transcripts";
import { addedPatch, DIFF_FLAGS, parseRawDiff, readWorkingFile } from "./repository/review";
import { route, type Route, type RouteContext } from "./routes";
import { HostError } from "./runtime/errors";
import { git, ProcessFailure } from "./runtime/process";

// Attempts compare the threads of one task (saved reviews with the same
// group) and keep one of them. Compare reads each attempt's checkout and its
// lead session's transcript, and changes nothing. Keep archives the other
// attempts; before Med removes a worktree, it saves the worktree's changes as
// a commit on the attempt's own branch, so Git removes it without force and
// nothing is lost. Undo adds the worktree back and puts the changes back as
// uncommitted changes.

/** What attempts need from the host. */
export interface AttemptsHost {
  /** Every saved review, archived ones too. */
  reviews(): Promise<SavedReview[]>;
  /** The lead session's state. */
  status(review: SavedReview): Promise<{ state?: string } | undefined>;
  /** The updates of an ACP session, which Med keeps itself. */
  ownedEvents(sessionId: string): Promise<SessionEvent[]>;
  /** The model of a session that Med runs. */
  ownedModel(sessionId: string): string | undefined;
  archive(id: string, archived: boolean): Promise<unknown>;
  rename(id: string, title: string): Promise<unknown>;
  /** The registered repository that a checkout belongs to. */
  repository(path: string): RegisteredRepository | undefined;
  /** Stops the agents that Med runs in a checkout and that work; returns how many. */
  stopAgents(path: string): number;
  /** Removes a linked worktree as archiving a thread does: Git keeps one with changes. */
  removeWorktree(path: string, signal: AbortSignal): Promise<void>;
  /** Lists a repository's worktrees again, after Undo adds one back. */
  refresh(path: string): Promise<unknown>;
}

/** The page shows at most this many files, and this much patch text. */
const MAX_FILES = 80;
const FILE_PATCH_BYTES = 256 * 1024;
const PAGE_PATCH_BYTES = 6 * 1024 * 1024;
const MAX_UNTRACKED = 200;
const MAX_CHECKS = 6;
const MESSAGE_CHARS = 2400;

/** Where an attempt works, and the commit that its first hand-off started from. */
const primary = (review: SavedReview) => {
  const checkout = threadCheckout(review)!;
  const target = review.targets.find((entry) => !entry.commentReviewId);
  return { repo: checkout.repo, branch: checkout.branch, base: target?.base ?? "" };
};
const byAttempt = (a: SavedReview, b: SavedReview) =>
  (a.group?.attempt ?? 0) - (b.group?.attempt ?? 0);
const text = async (cwd: string, args: string[], signal?: AbortSignal) =>
  (await git(cwd, args, { signal, maxBytes: 4 * 1024 * 1024 })).toString("utf8").trim();
const commitOf = (cwd: string, ref: string, signal?: AbortSignal) =>
  text(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], signal);
/** Git's last line, without "fatal:", for a note. */
const reason = (error: unknown) =>
  ((error instanceof ProcessFailure ? error.stderr : "") || (error as Error)?.message || "")
    .trim()
    .split("\n")
    .filter((line) => !/^hint/.test(line))
    .at(-1)
    ?.replace(/^(fatal|error): /, "") ?? "";

// ------------------------------------------------------------ the session

/** Programs that check work: tests, type checks, linters, and builds. */
const CHECK_PROGRAM =
  /^(?:bunx\s+|npx\s+|pnpm\s+(?:exec|dlx)\s+|yarn\s+(?:dlx\s+)?)?(?:bun\s+test\b|bun\s+run\s+(?:test|check|lint|typecheck|build)\b|(?:npm|pnpm|yarn)\s+(?:test\b|run\s+(?:test|check|lint|typecheck|build)\b)|vitest\b|jest\b|mocha\b|playwright\s+test\b|pytest\b|python3?\s+-m\s+(?:pytest|unittest)\b|cargo\s+(?:test|check|clippy|build)\b|go\s+(?:test|vet|build)\b|make\s+(?:test|check)\b|tsc\b|oxlint\b|eslint\b|biome\s+(?:check|lint)\b|ruff\b|mypy\b|swift\s+(?:test|build)\b|xcodebuild\b.*\btest\b|deno\s+(?:test|check|lint)\b|\.\/gradlew\s+test\b|mvn\s+test\b)/;

/** Whether a shell command runs a check, such as `TZ=UTC bun test` or `cd app && cargo test`. */
export function isCheckCommand(command: string) {
  return command.split(/&&|\|\||;|\||\n/).some((part) =>
    CHECK_PROGRAM.test(
      part
        .trim()
        .replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, "")
        .replace(/^(?:time|exec|env)\s+/, ""),
    ),
  );
}

/** Counts from a check's output, such as "5 pass · 1 fail", or its exit code. */
function checkSummary(output: string, failed: boolean) {
  const tail = output.slice(-8000);
  const number = (...patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = pattern.exec(tail);
      if (match) return Number(match[1]);
    }
    return undefined;
  };
  // bun test, then Vitest, Jest, pytest, and cargo.
  const pass = number(/^\s*(\d+) pass\b/m, /\b(\d+) passed\b/);
  const fail = number(/^\s*(\d+) fail\b/m, /\b(\d+) failed\b/);
  if (pass !== undefined || fail !== undefined)
    return [pass !== undefined ? `${pass} pass` : "", fail ? `${fail} fail` : ""]
      .filter(Boolean)
      .join(" · ");
  const exit = number(/^Exit code:? (\d+)/m);
  return failed && exit ? `Exit ${exit}` : undefined;
}

const contentText = (content: ToolCallContent[] | undefined) =>
  (content ?? [])
    .map((part) =>
      part.type === "content" && part.content.type === "text" ? part.content.text : "",
    )
    .join("\n");

/** The checks in a session's updates, the latest last. */
export function sessionChecks(events: SessionEvent[], working: boolean): AttemptCheck[] {
  const calls = new Map<string, { command: string; at: number; status?: string; output: string }>();
  for (const { at, update } of events) {
    if (update.sessionUpdate === "tool_call") {
      const input = update.rawInput as { command?: unknown } | undefined;
      const command = typeof input?.command === "string" ? input.command.trim() : "";
      if (!command || !isCheckCommand(command)) continue;
      calls.set(update.toolCallId, {
        command,
        at,
        status: update.status,
        output: contentText(update.content),
      });
    } else if (update.sessionUpdate === "tool_call_update") {
      const call = calls.get(update.toolCallId);
      if (!call) continue;
      if (update.status) call.status = update.status;
      const output = contentText(update.content);
      if (output) call.output = output;
    }
  }
  return [...calls.values()].slice(-MAX_CHECKS).map((call) => {
    const status =
      call.status === "completed"
        ? "passed"
        : call.status === "failed"
          ? "failed"
          : working
            ? "running"
            : "unknown";
    const summary = checkSummary(call.output, status === "failed");
    return { command: call.command, status, ...(summary ? { summary } : {}), at: call.at };
  });
}

/** The agent's last message: the chunks of its last reply. */
export function lastMessage(events: SessionEvent[]) {
  let index = events.length - 1;
  while (index >= 0 && events[index]!.update.sessionUpdate !== "agent_message_chunk") index--;
  if (index < 0) return undefined;
  const last = events[index]!.update as Extract<
    SessionEvent["update"],
    { sessionUpdate: "agent_message_chunk" }
  >;
  const parts: string[] = [];
  for (let at = index; at >= 0; at--) {
    const update = events[at]!.update;
    if (update.sessionUpdate !== "agent_message_chunk") break;
    if (update.messageId !== last.messageId) break;
    if (update.content.type === "text") parts.unshift(update.content.text);
  }
  const message = parts.join("").trim();
  if (!message) return undefined;
  return message.length > MESSAGE_CHARS ? `${message.slice(0, MESSAGE_CHARS).trimEnd()}…` : message;
}

/** The model of a Codex rollout, from its turn context near the start. */
async function codexModel(path: string) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
      if (!line.includes('"turn_context"')) continue;
      try {
        const model = (JSON.parse(line) as { payload?: { model?: unknown } }).payload?.model;
        if (typeof model === "string") return model;
      } catch {
        /* A line cut at the end of the read. */
      }
    }
  } finally {
    await handle.close();
  }
  return undefined;
}

/** Claude Code names the model on each reply. */
function claudeModel(events: SessionEvent[]) {
  for (let index = events.length - 1; index >= 0; index--) {
    const model = events[index]!.update._meta?.med?.model;
    if (model) return model;
  }
  return undefined;
}

interface SessionFacts {
  agent?: string;
  kind?: AgentSession["agent"];
  model?: string;
  startedAt?: number;
  endedAt?: number;
  checks: AttemptCheck[];
  lastMessage?: string;
}

// ---------------------------------------------------------------- the diff

const STATUS: Record<string, AttemptFileChange["status"]> = {
  A: "added",
  C: "added",
  D: "deleted",
  R: "renamed",
};

/** One file's change from a section of `git diff`. */
function sectionChange(
  status: string,
  previousPath: string | undefined,
  section: string | undefined,
): AttemptFileChange {
  const change: AttemptFileChange = {
    status: STATUS[status] ?? "modified",
    ...(previousPath ? { previousPath } : {}),
    additions: 0,
    deletions: 0,
  };
  if (section === undefined) return { ...change, tooLarge: true };
  if (/^Binary files .* differ$/m.test(section) || /^GIT binary patch$/m.test(section))
    return { ...change, binary: true };
  let inHunk = false;
  for (const line of section.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && line.startsWith("+")) change.additions++;
    else if (inHunk && line.startsWith("-")) change.deletions++;
  }
  return Buffer.byteLength(section) > FILE_PATCH_BYTES
    ? { ...change, tooLarge: true }
    : { ...change, patch: section };
}

/** A checkout's changes since `base`: commits, uncommitted changes, and new files. */
async function changesSince(checkout: string, base: string, signal?: AbortSignal) {
  const files: { path: string; change: AttemptFileChange }[] = [];
  const raw = await git(
    checkout,
    ["diff", ...DIFF_FLAGS, "--raw", "-z", "--no-abbrev", base, "--"],
    {
      signal,
      maxBytes: 4 * 1024 * 1024,
    },
  );
  const listed = parseRawDiff(raw);
  let sections: string[] = [];
  try {
    const patch = await git(checkout, ["diff", ...DIFF_FLAGS, "--patch", base, "--"], {
      signal,
      maxBytes: 16 * 1024 * 1024,
    });
    sections = patch
      .toString("utf8")
      .split(/(?=^diff --git )/m)
      .filter((part) => part.startsWith("diff --git "));
  } catch (error) {
    if (!(error instanceof ProcessFailure) || error.code !== "output-too-large") throw error;
  }
  // Raw records and patch sections come in the same order.
  listed.forEach((file, index) =>
    files.push({
      path: file.path,
      change: sectionChange(file.status, file.previousPath, sections[index]),
    }),
  );
  const untracked = (
    await git(checkout, ["ls-files", "--others", "--exclude-standard", "-z"], {
      signal,
      maxBytes: 2 * 1024 * 1024,
    })
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const path of untracked.slice(0, MAX_UNTRACKED)) {
    try {
      const { patch, lines } = addedPatch(path, await readWorkingFile(checkout, path));
      files.push({
        path,
        change: {
          status: "added",
          additions: lines,
          deletions: 0,
          ...(Buffer.byteLength(patch) > FILE_PATCH_BYTES ? { tooLarge: true } : { patch }),
        },
      });
    } catch (error) {
      const binary = error instanceof HostError && error.code === "binary-source";
      files.push({
        path,
        change: {
          status: "added",
          additions: 0,
          deletions: 0,
          ...(binary ? { binary: true } : { tooLarge: true }),
        },
      });
    }
  }
  return { files, more: Math.max(0, untracked.length - MAX_UNTRACKED) };
}

/** Files that more attempts changed first; then by which attempts, then by path. */
function mergeFiles(
  results: ({ files: { path: string; change: AttemptFileChange }[] } | undefined)[],
) {
  const rows = new Map<string, (AttemptFileChange | null)[]>();
  results.forEach((result, index) => {
    for (const { path, change } of result?.files ?? []) {
      let row = rows.get(path);
      if (!row) rows.set(path, (row = results.map(() => null)));
      row[index] = change;
    }
  });
  const shape = (changes: (AttemptFileChange | null)[]) =>
    changes.map((change) => (change ? "1" : "0")).join("");
  const files: AttemptFile[] = [...rows].map(([path, changes]) => ({ path, changes }));
  files.sort((a, b) => {
    const count = (file: AttemptFile) => file.changes.filter(Boolean).length;
    return (
      count(b) - count(a) ||
      shape(b.changes).localeCompare(shape(a.changes)) ||
      a.path.localeCompare(b.path)
    );
  });
  // A page budget for the patch text: later files show without their diff.
  let bytes = 0;
  for (const file of files)
    for (const change of file.changes) {
      if (!change?.patch) continue;
      bytes += Buffer.byteLength(change.patch);
      if (bytes > PAGE_PATCH_BYTES) {
        delete change.patch;
        change.tooLarge = true;
      }
    }
  return files;
}

// ------------------------------------------------------------------ keep

interface KeptRecord {
  kept: { id: string; attempt: number; title?: string };
  /** A checkout of the repository, for `git worktree add`. */
  main: string;
  others: {
    id: string;
    attempt: number;
    checkout: string;
    branch?: string;
    removed: boolean;
    /** The commit that saved the worktree's changes, and the commit before it. */
    saved?: { before: string; commit: string };
  }[];
}

/** Saves a worktree's changes as a commit on its branch, so Git can remove the
 * worktree without force. Hooks do not run: this is a save, not a review. */
async function saveWork(checkout: string, message: string) {
  const status = await git(checkout, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    maxBytes: 4 * 1024 * 1024,
  });
  if (!status.length) return undefined;
  const before = await commitOf(checkout, "HEAD");
  await git(checkout, ["add", "-A"], { timeoutMs: 120_000 });
  try {
    await git(
      checkout,
      ["-c", "commit.gpgsign=false", "commit", "--no-verify", "--quiet", "-m", message],
      { timeoutMs: 120_000 },
    );
  } catch (error) {
    // The index comes back as it was; the files never changed.
    await git(checkout, ["reset", "--quiet"]).catch(() => {});
    throw error;
  }
  return { before, commit: await commitOf(checkout, "HEAD") };
}

export class AttemptGroups {
  private kept = new Map<string, KeptRecord>();
  private busy = new Set<string>();
  private transcripts = new Map<string, string>();
  private facts = new Map<string, { key: string; facts: SessionFacts }>();
  constructor(private host: AttemptsHost) {}

  private async members(group: string, reviews?: SavedReview[]) {
    const all = (reviews ?? (await this.host.reviews())).filter(
      (review) => review.group?.id === group,
    );
    if (!all.length)
      throw new HostError("attempts-not-found", "Med has no attempts in this group.", 404);
    all.sort(byAttempt);
    return { all, open: all.filter((review) => !review.archivedAt), title: all[0]!.title };
  }

  /** What the lead session did: its agent, model, time, checks, and last reply. */
  private async sessionFacts(review: SavedReview, working: boolean): Promise<SessionFacts> {
    const session = review.sessions?.at(-1);
    if (!session) return { checks: [] };
    const base = { agent: agentName(session), kind: session.agent };
    try {
      if (session.agent === "acp") {
        const events = await this.host.ownedEvents(session.id);
        const model = this.host.ownedModel(session.id);
        return {
          ...base,
          ...(model ? { model: modelName(model) } : {}),
          startedAt: events[0]?.at,
          endedAt: events.at(-1)?.at,
          checks: sessionChecks(events, working),
          lastMessage: lastMessage(events),
        };
      }
      let path = this.transcripts.get(session.id);
      if (!path || !existsSync(path)) {
        path = await findTranscript(session);
        if (!path) return { ...base, checks: [] };
        this.transcripts.set(session.id, path);
      }
      const info = await stat(path);
      const key = `${path}:${info.size}:${info.mtimeMs}:${working}`;
      const known = this.facts.get(session.id);
      if (known?.key === key) return known.facts;
      const { events } = await readTranscriptPage(session, path, info.size);
      // A session that Med runs has the model that it chose, also before a reply names it.
      const model =
        (session.agent === "codex" ? await codexModel(path) : claudeModel(events)) ??
        this.host.ownedModel(session.id);
      const turns = await transcriptTurns(session, path).catch(() => []);
      const facts: SessionFacts = {
        ...base,
        ...(model ? { model: modelName(model) } : {}),
        startedAt: turns[0]?.at ?? events[0]?.at,
        endedAt: events.at(-1)?.at,
        checks: sessionChecks(events, working),
        lastMessage: lastMessage(events),
      };
      this.facts.set(session.id, { key, facts });
      return facts;
    } catch {
      return { ...base, checks: [] };
    }
  }

  /** The commit that the attempts started from: their common ancestor. */
  private async base(repo: string, heads: string[], reviews: SavedReview[]) {
    if (!heads.length) return undefined;
    let sha: string;
    if (heads.length > 1) sha = await text(repo, ["merge-base", "--octopus", ...heads]);
    else {
      // One attempt left: the commit that its review started from, if the branch has it.
      const saved = primary(reviews[0]!).base;
      sha =
        /^[0-9a-f]{40}$/.test(saved) && (await commitOf(repo, saved).catch(() => ""))
          ? saved
          : heads[0]!;
    }
    const branches = (
      await text(repo, [
        "for-each-ref",
        "--points-at",
        sha,
        "--format=%(refname:short)",
        "refs/heads",
      ])
    )
      .split("\n")
      .filter(Boolean);
    const branch = ["main", "master"].find((name) => branches.includes(name)) ?? branches[0];
    return { sha, ...(branch ? { branch } : {}) };
  }

  async compare(group: string, context: RouteContext): Promise<AttemptCompare> {
    const { open: members, title } = await this.members(group);
    const checkouts = members.map((review) => primary(review).repo);
    const family = checkouts.map((path) => this.host.repository(path)).find(Boolean);
    // A checkout that is gone, or not in a registered repository, has no changes to read.
    const heads = await Promise.all(
      checkouts.map(async (checkout) => {
        if (!existsSync(checkout)) return { problem: "Its worktree is gone." };
        try {
          await context.requireRepo(checkout);
          return { head: await commitOf(checkout, "HEAD", context.signal) };
        } catch {
          return { problem: "Add its repository to Med to read its changes." };
        }
      }),
    );
    const present = heads.flatMap((entry) => (entry.head ? [entry.head] : []));
    const base = await this.base(
      family?.path ?? checkouts.find((path, index) => heads[index]!.head) ?? checkouts[0]!,
      present,
      members.filter((_, index) => heads[index]!.head),
    ).catch(() => undefined);
    const states = await Promise.all(members.map((review) => this.host.status(review)));
    const [facts, results] = await Promise.all([
      Promise.all(
        members.map((review, index) =>
          this.sessionFacts(review, states[index]?.state === "working"),
        ),
      ),
      Promise.all(
        members.map(async (_, index) => {
          if (!base || !heads[index]!.head) return undefined;
          try {
            return await changesSince(checkouts[index]!, base.sha, context.signal);
          } catch (error) {
            context.signal.throwIfAborted();
            return { files: [], more: 0, problem: reason(error) || "Git could not read it." };
          }
        }),
      ),
    ]);
    const attempts: Attempt[] = members.map((review, index) => {
      const target = primary(review);
      const fact = facts[index]!;
      const result = results[index];
      const state = states[index]?.state;
      const files = result?.files ?? [];
      const problem =
        heads[index]!.problem ?? (result && "problem" in result ? result.problem : undefined);
      return {
        threadId: review.id,
        attempt: review.group!.attempt,
        title: review.title,
        ...(fact.agent ? { agent: fact.agent } : {}),
        ...(fact.kind ? { kind: fact.kind } : {}),
        ...(fact.model ? { model: fact.model } : {}),
        ...(review.group?.label ? { label: review.group.label } : {}),
        ...(state === "working" || state === "waiting" || state === "idle" ? { state } : {}),
        ...(target.branch ? { branch: target.branch } : {}),
        checkout: target.repo,
        ...(fact.startedAt ? { startedAt: fact.startedAt } : {}),
        ...(fact.endedAt && state !== "working" ? { endedAt: fact.endedAt } : {}),
        changes: {
          files: files.length + (result?.more ?? 0),
          additions: files.reduce((sum, file) => sum + file.change.additions, 0),
          deletions: files.reduce((sum, file) => sum + file.change.deletions, 0),
        },
        checks: fact.checks,
        ...(fact.lastMessage ? { lastMessage: fact.lastMessage } : {}),
        ...(problem ? { problem } : {}),
      };
    });
    const files = mergeFiles(results);
    const kept = this.kept.get(group);
    return {
      group,
      title,
      ...(family ? { repository: { id: family.id, name: family.name, path: family.path } } : {}),
      ...(base ? { base } : {}),
      attempts,
      files: files.slice(0, MAX_FILES),
      ...(files.length > MAX_FILES ? { moreFiles: files.length - MAX_FILES } : {}),
      ...(kept && members.some((review) => review.id === kept.kept.id)
        ? { kept: { threadId: kept.kept.id, attempt: kept.kept.attempt } }
        : {}),
    };
  }

  /** Makes one attempt the thread: archives the others and removes their worktrees. */
  async keep(group: string, threadId: string): Promise<AttemptKept> {
    if (this.busy.has(group))
      throw new HostError("attempts-busy", "Med is changing these attempts now.", 409);
    this.busy.add(group);
    try {
      const reviews = await this.host.reviews();
      const { all, open, title } = await this.members(group, reviews);
      const kept = open.find((review) => review.id === threadId);
      if (!kept)
        throw new HostError(
          "attempt-not-found",
          "This attempt is archived or not in the group.",
          404,
        );
      const others = open.filter((review) => review !== kept);
      if (!others.length)
        throw new HostError("attempts-none-left", "The other attempts are archived already.", 409);
      const keptLetter = attemptLetter(kept.group!.attempt);
      const main = primary(kept).repo;
      const record: KeptRecord = {
        kept: { id: kept.id, attempt: kept.group!.attempt },
        main: this.host.repository(main)?.path ?? main,
        others: [],
      };
      const notes: string[] = [];
      const archived: AttemptKept["archived"] = [];
      // Removal needs no request: a closed page does not stop it halfway.
      const signal = new AbortController().signal;
      for (const review of others) {
        const letter = attemptLetter(review.group!.attempt);
        const checkout = primary(review).repo;
        const entry: KeptRecord["others"][number] = {
          id: review.id,
          attempt: review.group!.attempt,
          checkout,
          removed: false,
        };
        let stopped = false;
        const linked = this.host
          .repository(checkout)
          ?.worktrees.some((tree) => tree.path === checkout && tree.linked);
        // A thread outside the group that works in the same checkout keeps it.
        const shared = reviews.find(
          (other) =>
            !other.archivedAt &&
            !all.includes(other) &&
            (threadCheckout(other)?.repo === checkout ||
              other.targets.some((target) => target.repo === checkout)),
        );
        if (linked && existsSync(checkout)) {
          stopped = this.host.stopAgents(checkout) > 0;
          // A stopped agent can write once more as it exits.
          if (stopped) await new Promise((done) => setTimeout(done, 400));
          const state = (await this.host.status(review))?.state;
          if (shared) notes.push(`Med kept ${letter}'s worktree: "${shared.title}" works in it.`);
          else if (!stopped && (state === "working" || state === "waiting"))
            notes.push(`Med kept ${letter}'s worktree: its agent still works there.`);
          else
            try {
              entry.branch =
                (await text(checkout, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
                  () => "",
                )) || undefined;
              if (!entry.branch) throw new Error("its checkout is not on a branch.");
              const saved = await saveWork(
                checkout,
                `Attempt ${letter} of "${title}", not kept\n\nMed saved this work when you kept attempt ${keptLetter}. Undo in Med brings it back as uncommitted changes.`,
              );
              if (saved) entry.saved = saved;
              await this.host.removeWorktree(checkout, signal);
              entry.removed = true;
            } catch (error) {
              notes.push(`Med kept ${letter}'s worktree: ${reason(error)}`);
            }
        }
        await this.host.archive(review.id, true);
        record.others.push(entry);
        archived.push({
          threadId: review.id,
          attempt: entry.attempt,
          removed: entry.removed,
          stopped,
        });
      }
      if (kept.title !== title) {
        record.kept.title = kept.title;
        await this.host.rename(kept.id, title);
      }
      this.kept.set(group, record);
      return {
        group,
        threadId: kept.id,
        attempt: kept.group!.attempt,
        title,
        archived,
        notes,
      };
    } finally {
      this.busy.delete(group);
    }
  }

  /** Brings back the attempts that Keep archived, with their worktrees and changes. */
  async undo(group: string): Promise<AttemptUndo> {
    const record = this.kept.get(group);
    if (!record)
      throw new HostError(
        "attempts-no-undo",
        "There is nothing to undo here, or Med restarted after the keep.",
        409,
      );
    if (this.busy.has(group))
      throw new HostError("attempts-busy", "Med is changing these attempts now.", 409);
    this.busy.add(group);
    try {
      const restored: string[] = [];
      for (const entry of record.others) {
        const letter = attemptLetter(entry.attempt);
        if (entry.removed && entry.branch && !existsSync(entry.checkout)) {
          try {
            await git(record.main, ["worktree", "add", entry.checkout, entry.branch], {
              timeoutMs: 5 * 60_000,
            });
            // The saved changes become uncommitted changes again.
            if (entry.saved && (await commitOf(entry.checkout, "HEAD")) === entry.saved.commit)
              await git(entry.checkout, ["reset", "--quiet", "--mixed", entry.saved.before]);
            await this.host.refresh(record.main).catch(() => {});
            restored.push(`${letter} with its worktree`);
          } catch (error) {
            restored.push(`${letter} without its worktree (${reason(error)})`);
          }
        } else restored.push(letter);
        await this.host.archive(entry.id, false);
      }
      if (record.kept.title) await this.host.rename(record.kept.id, record.kept.title);
      this.kept.delete(group);
      return { restored };
    } finally {
      this.busy.delete(group);
    }
  }

  /** The routes, for the host's route table. */
  routes(): Route[] {
    return [
      route(attemptRoutes.compare, ({ group }, context) => this.compare(group, context)),
      route(attemptRoutes.keep, ({ group, threadId }) => this.keep(group, threadId)),
      route(attemptRoutes.undo, ({ group }) => this.undo(group)),
    ];
  }
}
