import { useCallback, useMemo } from "react";
import type { BrowseEntry } from "../../shared/browse";
import type { Thread } from "../../shared/threads";
import { useVaultsFiles, type BrowseApi, type Vault } from "./browse";
import { matchScore } from "./file-filters";

/** What @ names in a message to an agent: a file, a vault's note, or a thread. */
export type MentionKind = "file" | "note" | "thread";
export interface MentionCandidate {
  id: string;
  kind: MentionKind;
  /** The name that it goes by in the message box, such as App.tsx. */
  name: string;
  /** Where it is: its folder, its vault, or its repository. */
  detail: string;
  /** The absolute path that the agent reads. A thread's comes from the host. */
  path?: string;
  thread?: Thread;
}
/** What @ can name, as the workspace has it. */
export interface MentionSources {
  /** The checkout and its files. */
  files?: { root: string; entries: readonly BrowseEntry[] };
  notes: readonly { vault: { name: string; path: string }; entries: readonly BrowseEntry[] }[];
  /** The most recent first. */
  threads: readonly Thread[];
  /** The absolute path that names a thread to an agent: its session's transcript. */
  resolveThread(thread: Thread): Promise<string>;
}
/** A mention in the message box: its token, and the path that replaces it. */
export interface Mention {
  label: string;
  path: string | Promise<string>;
}

const MARKDOWN = /\.(?:md|markdown|mdown|mkd)$/i;
const join = (root: string, path: string) => `${root.replace(/\/+$/, "")}/${path}`;
const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const folder = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

function best<T>(items: readonly T[], score: (item: T) => number, limit: number) {
  const ranked: { item: T; score: number }[] = [];
  for (const item of items) {
    const value = score(item);
    if (value === -Infinity) continue;
    if (ranked.length === limit && value <= ranked[limit - 1]!.score) continue;
    let index = ranked.findIndex((entry) => entry.score < value);
    if (index < 0) index = ranked.length;
    ranked.splice(index, 0, { item, score: value });
    if (ranked.length > limit) ranked.pop();
  }
  return { items: ranked.map((entry) => entry.item), top: ranked[0]?.score ?? -Infinity };
}

/** The best few of each kind for a query, the kind with the best match first.
 * An empty query lists recent threads. */
export function findMentions(sources: MentionSources, query: string) {
  const sections: { kind: MentionKind; items: MentionCandidate[]; top: number }[] = [];
  const files = sources.files;
  if (query && files) {
    const found = best(
      files.entries.filter((entry) => entry.kind === "file"),
      (entry) => matchScore(entry.path, query),
      6,
    );
    const items = found.items.map((entry) => ({
      id: `file:${entry.path}`,
      kind: "file" as const,
      name: name(entry.path),
      detail: folder(entry.path),
      path: join(files.root, entry.path),
    }));
    if (items.length) sections.push({ kind: "file", items, top: found.top });
  }
  if (query) {
    const notes = sources.notes.flatMap(({ vault, entries }) =>
      entries
        .filter((entry) => MARKDOWN.test(entry.path))
        .map((entry) => ({ vault, path: entry.path })),
    );
    const found = best(notes, (note) => matchScore(note.path, query), 5);
    const items = found.items.map((note) => ({
      id: `note:${note.vault.path}:${note.path}`,
      kind: "note" as const,
      name: name(note.path),
      detail: [note.vault.name, folder(note.path)].filter(Boolean).join(" · "),
      path: join(note.vault.path, note.path),
    }));
    if (items.length) sections.push({ kind: "note", items, top: found.top });
  }
  const threads = query
    ? best(sources.threads, (thread) => matchScore(thread.title, query), 4)
    : { items: sources.threads.slice(0, 5), top: 0 };
  if (threads.items.length)
    sections.push({
      kind: "thread",
      top: threads.top,
      items: threads.items.map((thread) => ({
        id: `thread:${thread.id}`,
        kind: "thread" as const,
        name: thread.title,
        detail: [thread.repository?.name, thread.branch].filter(Boolean).join(" · "),
        thread,
      })),
    });
  return sections.sort((a, b) => b.top - a.top);
}

/** The token for a candidate: its name, with its folder when another mention
 * has the same name for another path. */
export function mentionLabel(candidate: MentionCandidate, taken: readonly Mention[]) {
  if (candidate.kind === "thread" || !candidate.path) return candidate.name;
  const parts = candidate.path.split("/");
  for (let size = 1; size <= parts.length; size += 1) {
    const label = parts.slice(-size).join("/");
    const other = taken.find((mention) => mention.label === label);
    if (!other || other.path === candidate.path) return label;
  }
  return candidate.path;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A token only where it ends: `@App.ts` does not match in `@App.tsx`. */
const tokenPattern = (label: string) => new RegExp(`@${escape(label)}(?![\\w./-])`, "g");

/** The text after an @ starts with a mention's whole token: the mention is done. */
export function startsWithMention(query: string, mentions: readonly Mention[]) {
  return mentions.some((mention) =>
    new RegExp(`^${escape(mention.label)}(?![\\w./-])`).test(query),
  );
}

/** The parts of the text, with the tokens of its mentions marked. */
export function mentionParts(text: string, mentions: readonly Mention[]) {
  const marks: { start: number; end: number }[] = [];
  for (const mention of mentions)
    for (const match of text.matchAll(tokenPattern(mention.label)))
      marks.push({ start: match.index, end: match.index + match[0].length });
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: { text: string; mention: boolean }[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start < at) continue;
    if (mark.start > at) parts.push({ text: text.slice(at, mark.start), mention: false });
    parts.push({ text: text.slice(mark.start, mark.end), mention: true });
    at = mark.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), mention: false });
  return parts;
}

/** The message as the agent gets it: each token replaced by its absolute path,
 * in backticks when the path has a space. */
export async function expandMentions(text: string, mentions: readonly Mention[]) {
  let message = text;
  // Longer tokens first, so `@web/App.tsx` is not read as `@App.tsx`.
  for (const mention of [...mentions].sort((a, b) => b.label.length - a.label.length)) {
    const pattern = tokenPattern(mention.label);
    if (!pattern.test(message)) continue;
    const path = await mention.path;
    const quoted = /\s/.test(path) ? `\`${path}\`` : path;
    message = message.replace(tokenPattern(mention.label), () => quoted);
  }
  return message;
}

/** The absolute path that names a thread to an agent: its latest session's
 * transcript, or else its checkout. */
export async function threadPath(api: BrowseApi, thread: Thread) {
  const session = thread.sessions?.at(-1);
  const transcript =
    session && session.agent !== "acp" && api.transcript
      ? await api.transcript(thread.id, session.id).catch(() => undefined)
      : undefined;
  const path = transcript ?? thread.checkout;
  if (!path) throw new Error("This thread has no transcript or checkout on this computer.");
  return path;
}

/** What @ names in a message box: a checkout's files, the vaults' notes, and
 * threads. `round` counts the times that @ opened; each lists the notes again. */
export function useMentionSources(
  api: BrowseApi,
  files: MentionSources["files"],
  threads: readonly Thread[],
  vaults: readonly Vault[],
  round: number,
): MentionSources {
  const notes = useVaultsFiles(api, vaults, round);
  const resolveThread = useCallback((thread: Thread) => threadPath(api, thread), [api]);
  return useMemo(
    () => ({ files, notes, threads, resolveThread }),
    [files, notes, threads, resolveThread],
  );
}
