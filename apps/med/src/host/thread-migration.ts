import { readFile, rename } from "node:fs/promises";
import { z } from "zod";
import { agentSessionSchema, type AgentSession } from "../shared/saved-review";
import { sessionKey } from "../shared/threads";
import type { SavedReviewStore } from "./saved-reviews";
import { SUPERAGENT_KEY, SUPERAGENT_TITLE } from "./superagent";
import type { ThreadEntry, ThreadStore } from "./thread-store";

// The first start of a Med whose threads are sessions reads the tabs of the
// Med before it (`tabs.json`), where each saved review was a thread and a
// found session had a `found-…` ID. A review that a session handed off goes
// to that session's thread, with the review's name, pin, and seen mark; a
// review without a session stays a thread of its own. A review without a
// comparison was only a session's place to live: it goes.

const FOUND_ID = /^found-(claude|codex)-([A-Za-z0-9_-]{1,128})$/;
const REVIEW_ID = /^r_[a-f0-9]{24}$/;

const oldSchema = z.object({
  version: z.literal(1),
  order: z.array(z.string()),
  entries: z.record(
    z.string(),
    z
      .object({
        closedAt: z.number().optional(),
        auto: z.boolean().optional(),
        prompt: z.string().max(400).optional(),
        name: z.string().max(120).optional(),
        stub: z
          .object({
            title: z.string().max(400),
            createdAt: z.string().max(64).optional(),
            repository: z.object({ id: z.string(), name: z.string(), path: z.string() }).optional(),
            checkout: z.string().optional(),
            linked: z.boolean().optional(),
            branch: z.string().optional(),
            sessions: z.array(agentSessionSchema).default([]),
            pullRequestUrl: z.string().optional(),
            updatedAt: z.number().optional(),
          })
          .optional(),
      })
      .passthrough(),
  ),
  pins: z.array(z.string()).optional(),
  prunedAt: z.number().optional(),
  seen: z.record(z.string(), z.number()).optional(),
  seenSince: z.number().optional(),
});

/** Moves an older Med's tabs into the thread store. False without them. */
export async function migrateTabs(options: {
  tabsFile: string;
  store: ThreadStore;
  savedReviews: SavedReviewStore;
  now?: () => number;
}): Promise<boolean> {
  const now = options.now ?? Date.now;
  let old: z.infer<typeof oldSchema>;
  try {
    old = oldSchema.parse(JSON.parse(await readFile(options.tabsFile, "utf8")));
  } catch {
    return false;
  }
  const reviews = await options.savedReviews.list();
  const byId = new Map(reviews.map((review) => [review.id, review]));
  /** The new thread of an old ID, and the session it is, if any. */
  const map = (id: string): { id: string; session?: AgentSession } | undefined => {
    const found = FOUND_ID.exec(id);
    if (found) {
      const session = { agent: found[1] as "claude" | "codex", id: found[2]!, cwd: "/" };
      return {
        id: sessionKey(session),
        session: old.entries[id]?.stub?.sessions.at(-1) ?? session,
      };
    }
    if (!REVIEW_ID.test(id)) return undefined;
    const review = byId.get(id);
    const session =
      review?.session ??
      old.entries[id]?.stub?.sessions.findLast((entry) => entry.agent !== "acp") ??
      old.entries[id]?.stub?.sessions.at(-1);
    if (session) return { id: sessionKey(session), session };
    // A review without a session, or one whose captures are gone.
    return review && review.targets.length ? { id } : undefined;
  };

  const entries: Record<string, ThreadEntry> = {};
  const open = new Set(old.order);
  /** The new threads that one of their old threads was a tab of. */
  const tabs = new Set<string>();
  const ids = new Set([...old.order, ...Object.keys(old.entries), ...reviews.map((r) => r.id)]);
  for (const oldId of ids) {
    const to = map(oldId);
    if (!to) continue;
    const before = old.entries[oldId];
    const stub = before?.stub;
    const entry = (entries[to.id] ??= {});
    if (to.session && (!entry.session || entry.session.cwd === "/")) entry.session = to.session;
    if (to.session && REVIEW_ID.test(oldId)) entry.kept = true;
    if (before?.name && !entry.name) entry.name = before.name;
    // The Superagent's review becomes its session, named and pinned on top,
    // as Med makes a new one.
    if (byId.get(oldId)?.key === SUPERAGENT_KEY) {
      entry.superagent = true;
      entry.name ??= SUPERAGENT_TITLE;
    }
    if (before?.prompt && !entry.prompt) entry.prompt = before.prompt;
    if (stub) {
      entry.title ??= stub.title;
      if (stub.createdAt) entry.createdAt ??= stub.createdAt;
      entry.updatedAt = Math.max(entry.updatedAt ?? 0, stub.updatedAt ?? 0) || undefined;
      entry.place ??= {
        ...(stub.repository && { repository: stub.repository }),
        ...(stub.checkout && { checkout: stub.checkout }),
        ...(stub.branch && { branch: stub.branch }),
        ...(stub.linked && { linked: true }),
      };
    }
    // A thread is a tab when one of its old threads was; archived otherwise,
    // when the last of them was archived.
    if (open.has(oldId)) tabs.add(to.id);
    else entry.closedAt = Math.max(entry.closedAt ?? 0, before?.closedAt ?? now());
  }
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.updatedAt === undefined) delete entry.updatedAt;
    if (tabs.has(id)) delete entry.closedAt;
  }
  const superagent = Object.keys(entries).filter((id) => entries[id]!.superagent);
  const pins = [
    ...new Set([
      ...superagent,
      ...(old.pins ?? []).flatMap((id) => (map(id) ? [map(id)!.id] : [])),
    ]),
  ].filter((id) => id in entries);
  const seen: Record<string, number> = {};
  for (const [id, at] of Object.entries(old.seen ?? {})) {
    const to = map(id);
    if (to && to.id in entries) seen[to.id] = Math.max(seen[to.id] ?? 0, at);
  }
  options.store.replace({
    entries,
    pins,
    seen,
    ...(old.seenSince !== undefined && { seenSince: old.seenSince }),
    ...(old.prunedAt !== undefined && { prunedAt: old.prunedAt }),
  });
  await options.store.save();
  // The reviews without a comparison were only a session's place to live.
  for (const review of reviews)
    if (!review.targets.length) await options.savedReviews.delete(review.id).catch(() => {});
  await rename(options.tabsFile, `${options.tabsFile}.before-sessions`).catch(() => {});
  return true;
}
