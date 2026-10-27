/**
 * `wb arctic save` and `wb arctic text`: save links to the Arctic library and
 * fetch their text, with the Workbench Backup credential.
 *
 * A new link is the three records that Arctic for the web and the phone
 * write (`newLinkRecords` in @workbench/arctic-links); a link from History is
 * saved again as a field edit of its library record (`savedLibrary`). The
 * shared API accepts exactly these writes from this credential, and one
 * more: a preview, which sets a link's empty `imageURL`, `faviconURL` and
 * `subtitle` from its page (`withPreview`), as Arctic on iPhone fills them.
 * The text and the preview come from Arctic's own extractor
 * (apps/arctic/Browser/scripts/text.ts), which loads only when a command
 * reads a page.
 */
import {
  articleId,
  canonicalURL,
  linkTitle,
  newLinkRecords,
  previewPatch,
  savedLibrary,
  toSwift,
  withPreview,
  type LinkPreview,
} from "@workbench/arctic-links";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareSyncHlc,
  createNamespacedHttpClient,
  createSyncClientState,
  observeSyncHlc,
  SyncHttpError,
  SyncNetworkError,
  tickSyncHlcBatch,
  type SyncClientState,
  type SyncRecord,
} from "@zsh-eng/local-sync";

const DEVICE = "wb-arctic";

/** Every request `wb arctic` makes: Arctic's records, its pushes and text files. */
const ALLOWED: [method: string, path: RegExp][] = [
  [
    "GET",
    /^\/api\/apps\/(arctic|arctic-content)\/sync\/v3\/(state|pull-stream)$/,
  ],
  ["POST", /^\/api\/apps\/(arctic|arctic-content)\/sync\/v3\/push$/],
  ["PUT", /^\/api\/apps\/arctic-content\/files\/xxh64:[a-f0-9]{16}$/],
];

/** A fetch that sends the credential with these requests and refuses all others. */
export function arcticFetch(origin: string, token: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const path = decodeURIComponent(url.pathname);
    if (
      url.origin !== origin ||
      !ALLOWED.some(
        ([allowed, pattern]) => allowed === method && pattern.test(path),
      )
    )
      throw Error(
        "wb arctic refused a request outside Arctic's links and text",
      );
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("User-Agent", "WorkbenchBackup/1");
    // A link push is not repeated: if a lost answer hid a stored push, the
    // server would refuse the repeat as already saved.
    const retries = path === "/api/apps/arctic/sync/v3/push" ? 0 : 3;
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        ...init,
        method,
        headers,
        redirect: "error",
        signal: init?.signal ?? AbortSignal.timeout(60_000),
      });
      if (
        attempt < retries &&
        (response.status === 429 || response.status >= 500)
      ) {
        await response.body?.cancel();
        await Bun.sleep(1000 * 2 ** attempt);
        continue;
      }
      return response;
    }
  }) as typeof fetch;
}

/** One namespace's latest records, and pushes that keep them current. */
async function openNamespace(
  origin: string,
  send: typeof fetch,
  namespace: string,
) {
  let state: SyncClientState = createSyncClientState(DEVICE);
  const { remote, request } = createNamespacedHttpClient({
    origin,
    namespace,
    fetch: send,
    stateStore: {
      read: () => state,
      write: (next) => {
        state = next;
      },
    },
  });
  await remote.getScope!();
  const records = new Map<string, SyncRecord>();
  for (let cursor = 0, head: number | undefined, more = true; more; ) {
    more = false;
    for await (const page of remote.pullStream!(
      DEVICE,
      {
        cursor,
        ...(head === undefined ? {} : { head }),
        limit: 500,
        excludeOwnDevice: false,
      },
      AbortSignal.timeout(120_000),
    )) {
      for (const record of page.records) records.set(record.key, record);
      ({ cursor, head, hasMore: more } = page);
    }
  }
  // Each push is newer than every record seen, so it wins over them.
  let clock = observeSyncHlc(
    { wallTimeMs: 0, counter: 0 },
    [...records.values()].map((record) => record.hlc),
  );
  return {
    /** Every key, removed ones included. */
    keys: () => records.keys(),
    /** A record's value, unless it is missing or removed. */
    live(key: string) {
      const record = records.get(key);
      return record && !record.isDeleted ? record.value : undefined;
    },
    async push(changes: { key: string; value: string }[]) {
      const hlcs = tickSyncHlcBatch(clock, changes.length, Date.now());
      clock = hlcs.at(-1) ?? clock;
      const sent = changes.map((change, index) => ({
        ...change,
        isDeleted: false,
        schemaVersion: 1,
        hlc: hlcs[index]!,
      }));
      const { results } = await remote.push!(DEVICE, sent);
      results.forEach(({ accepted, winner }, index) => {
        records.set(winner.key, winner);
        clock = observeSyncHlc(clock, [winner.hlc]);
        const mine = sent[index]!;
        // A retried push finds its own change already stored.
        const stored =
          winner.value === mine.value &&
          !winner.isDeleted &&
          winner.deviceId === DEVICE &&
          compareSyncHlc(winner.hlc, mine.hlc) === 0;
        if (!accepted && !stored)
          throw Error(
            `another device changed ${winner.key} meanwhile; try again`,
          );
      });
    },
    /** Uploads a text file and returns its id. */
    async upload(bytes: Uint8Array<ArrayBuffer>) {
      const file = `xxh64:${Bun.hash.xxHash64(bytes).toString(16).padStart(16, "0")}`;
      const response = await request(
        `/files/${file}`,
        {
          method: "PUT",
          body: bytes,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
        false,
      );
      if (((await response.json()) as { id?: string }).id !== file)
        throw Error("the server stored the text under another id");
      return file;
    },
  };
}

export type LinkResult = {
  input: string;
  url?: string;
  id?: string;
  /** What happened to the link in the library. */
  status:
    | "saved"
    | "already saved"
    | "restored"
    | "in history"
    | "not in library"
    | "invalid"
    | "failed";
  /** The new link's title: the page's own, or its host, as the phone's own add writes. */
  title?: string;
  /** What happened to its text. */
  text: "uploaded" | "kept" | "none" | "skipped";
  /** Words of the uploaded text, of the copy kept, or of a page too short to keep. */
  words?: number;
  /** Why there is no new text, such as "PDF" or "paywall preview". */
  reason?: string;
  /** The preview fields this filled: what the link lacked and its page has. */
  preview?: PreviewName[];
  /** Why the preview was not filled, when the page had one. */
  previewError?: string;
  error?: string;
};

/** The record's preview fields, as wb names them. */
const PREVIEW_NAMES = {
  imageURL: "image",
  subtitle: "description",
  faviconURL: "icon",
} as const;
type PreviewName = (typeof PREVIEW_NAMES)[keyof typeof PREVIEW_NAMES];

/**
 * An article record with the preview's fields where it has none, and those
 * fields by wb's names; undefined when it lacks nothing the page has.
 */
function fill(article: string, preview: LinkPreview) {
  const patch = previewPatch(JSON.parse(article), preview);
  if (!patch) return undefined;
  return {
    value: withPreview(article, preview)!,
    fields: Object.fromEntries(
      Object.entries(patch).map(([field, value]) => [
        PREVIEW_NAMES[field as keyof typeof PREVIEW_NAMES],
        value,
      ]),
    ) as Partial<Record<PreviewName, string>>,
  };
}

/** What `wb arctic` needs from Arctic's extractor (scripts/text.ts). */
type Reader = {
  read(url: string): Promise<{
    title: string;
    html?: string;
    words?: number;
    byline?: string;
    problem?: string;
    preview?: LinkPreview;
  }>;
  close(): Promise<void>;
};

/** What `wb arctic backfill-previews` needs: a link's preview alone. */
type PreviewReader = {
  preview(url: string): Promise<LinkPreview>;
  close(): Promise<void>;
};

/** A failure as wb says it: the server's reason, or what to do next. */
async function refusal(error: unknown): Promise<string> {
  // local-sync reports a failed fetch, such as the transport's refusal, as unreachable.
  if (error instanceof SyncNetworkError && error.cause instanceof Error)
    return refusal(error.cause);
  if (!(error instanceof SyncHttpError))
    return error instanceof Error ? error.message : String(error);
  if (error.status === 401)
    return "Session expired or revoked. Run wb auth login.";
  const body = (await error.response?.json().catch(() => ({}))) as {
    error?: string;
  };
  if (error.status === 403 && body.error === "Not allowed for a CLI credential")
    return "this server does not let wb save links yet";
  // A server from before previews refuses an article record alone.
  if (error.status === 403 && body.error?.endsWith("a restore writes its library record"))
    return "this server does not let wb fill previews yet";
  return body.error ?? error.message;
}

/**
 * Saves links (`save`) or fetches the text of links in the library (`text`),
 * one at a time, and reports each as it finishes. `read` replaces Arctic's
 * extractor in tests.
 */
export async function arctic(options: {
  command: "save" | "text";
  origin: string;
  token: string;
  inputs: string[];
  text: boolean;
  unwall?: boolean;
  read?: Reader;
  onResult?: (result: LinkResult) => void;
}) {
  const send = arcticFetch(options.origin, options.token);
  const [library, content] = await Promise.all([
    openNamespace(options.origin, send, "arctic"),
    openNamespace(options.origin, send, "arctic-content"),
  ]).catch(async (error) => {
    throw Error(await refusal(error));
  });
  let reader = options.read;
  const results: LinkResult[] = [];
  try {
    for (const input of options.inputs) {
      const result: LinkResult = { input, status: "invalid", text: "skipped" };
      try {
        const url = canonicalURL(input);
        if (!url) {
          result.error = "not a web address";
          continue;
        }
        const id = await articleId(url);
        Object.assign(result, { url, id });
        const known = library.live(`article/${id}`)
          ? library.live(`library/${id}`)
          : undefined;
        const saved = known !== undefined && JSON.parse(known).saved === true;
        const copy = content.live(`content/${id}`);
        const copyWords = copy
          ? Number(JSON.parse(copy).words) || 0
          : undefined;
        if (options.command === "text" && known === undefined) {
          result.status = "not in library";
          result.error = "save it first with wb arctic save";
          continue;
        }
        // Saving keeps text the account has; `wb arctic text` looks again.
        const read =
          options.text &&
          (options.command === "text" || copyWords === undefined)
            ? await (reader ??= await extractor(options.unwall)).read(url)
            : undefined;
        if (options.command === "text")
          result.status = saved ? "already saved" : "in history";
        else if (saved) result.status = "already saved";
        else if (known !== undefined) {
          await library.push([
            {
              key: `library/${id}`,
              value: savedLibrary(known, toSwift(Date.now())),
            },
          ]);
          result.status = "restored";
        } else {
          result.title = linkTitle(read?.title ?? "") || new URL(url).hostname;
          await library.push(
            newLinkRecords(url, id, {
              title: result.title,
              savedAt: toSwift(Date.now()),
            }),
          );
          result.status = "saved";
        }
        // The page's preview fills what the link lacks; the phone's own
        // fields stay. A refusal leaves the link saved.
        const article = library.live(`article/${id}`);
        const filled =
          options.command === "save" && read?.preview && article
            ? fill(article, read.preview)
            : undefined;
        if (filled)
          try {
            await library.push([{ key: `article/${id}`, value: filled.value }]);
            result.preview = Object.keys(filled.fields) as PreviewName[];
          } catch (error) {
            result.previewError = await refusal(error);
          }
        if (!options.text) continue;
        if (!read) {
          Object.assign(result, {
            text: "kept",
            words: copyWords,
            reason: "has text",
          });
          continue;
        }
        if (read.problem || read.html === undefined) {
          Object.assign(result, {
            text: "none",
            words: read.words,
            reason: read.problem,
          });
          continue;
        }
        const { copyProblem, copyRecord } =
          await import("../../arctic/Browser/src/copy");
        const problem = copyProblem(
          copyWords === undefined ? {} : { copy: { words: copyWords } },
          read.html,
          read.words!,
        );
        if (problem === "has a longer copy")
          Object.assign(result, {
            text: "kept",
            words: copyWords,
            reason: problem,
          });
        else if (problem)
          Object.assign(result, {
            text: "none",
            words: read.words,
            reason: problem.startsWith("under ") ? "too short" : problem,
          });
        else {
          const bytes = new TextEncoder().encode(read.html);
          const file = await content.upload(bytes);
          await content.push([
            copyRecord(
              { id, url },
              {
                file,
                bytes: bytes.byteLength,
                words: read.words!,
                byline: read.byline,
                source: "extractor",
              },
            ),
          ]);
          Object.assign(result, { text: "uploaded", words: read.words });
        }
      } catch (error) {
        result.error = await refusal(error);
        if (result.status === "invalid") result.status = "failed";
      } finally {
        results.push(result);
        options.onResult?.(result);
      }
    }
  } finally {
    await reader?.close();
  }
  return results;
}

async function extractor(unwall = false) {
  const { ArticleText } = await import("../../arctic/Browser/scripts/text");
  return new ArticleText({ unwall });
}

/** What `wb arctic backfill-previews` did, or would do, with one link. */
export type PreviewResult = {
  url: string;
  id: string;
  /**
   * "unreadable": the page gave no preview (an HTTP error, not HTML, a
   * timeout); "refused": the server refused the write.
   */
  status: "would fill" | "filled" | "nothing to fill" | "unreadable" | "refused";
  /** The fields filled, or that --apply would fill, and their values. */
  fields?: Partial<Record<PreviewName, string>>;
  error?: string;
};

/** The pause between two pages, so no publisher sees more than one a second. */
export const PREVIEW_GAP_MS = 1000;
/** Links whose preview `--apply` filled, or whose page had none to give. */
const STATE_FILE = "arctic-previews.json";

/**
 * Fills the previews of saved links that have none: no `imageURL`, as the
 * phone's `needsPreview` asks. Newest first, one page at a time, a second
 * apart. Without `apply` it only reads the pages and reports what it would
 * fill. With `apply` it pushes each link's preview (`withPreview`: empty
 * fields only) and notes the link in `<directory>/arctic-previews.json`, so
 * a later run resumes after it; an unreadable page, or a refused write, is
 * tried again next time.
 */
export async function backfillPreviews(options: {
  origin: string;
  token: string;
  directory: string;
  apply: boolean;
  limit?: number;
  gapMs?: number;
  read?: PreviewReader;
  onResult?: (result: PreviewResult) => void;
}) {
  const send = arcticFetch(options.origin, options.token);
  const library = await openNamespace(options.origin, send, "arctic").catch(
    async (error) => {
      throw Error(await refusal(error));
    },
  );
  const stateFile = join(options.directory, STATE_FILE);
  // One account's links per API origin.
  const state = (
    existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {}
  ) as Record<string, Record<string, string>>;
  const done = (state[options.origin] ??= {});
  const candidates: { id: string; url: string; savedAt: number }[] = [];
  for (const key of library.keys()) {
    if (!key.startsWith("article/")) continue;
    const id = key.slice("article/".length);
    const article = library.live(key);
    const saved = library.live(`library/${id}`);
    if (!article || !saved || done[id]) continue;
    const fields = JSON.parse(article) as Record<string, unknown>;
    const membership = JSON.parse(saved) as Record<string, unknown>;
    if (membership.saved !== true || fields.imageURL) continue;
    candidates.push({
      id,
      url: String(fields.url),
      savedAt: Number(membership.savedAt) || 0,
    });
  }
  candidates.sort((a, b) => b.savedAt - a.savedAt);
  const reader: PreviewReader = options.read ?? (await extractor());
  const results: PreviewResult[] = [];
  try {
    for (const [index, { id, url }] of candidates
      .slice(0, options.limit ?? candidates.length)
      .entries()) {
      if (index > 0) await Bun.sleep(options.gapMs ?? PREVIEW_GAP_MS);
      const result: PreviewResult = { url, id, status: "unreadable" };
      try {
        const filled = fill(
          library.live(`article/${id}`)!,
          await reader.preview(url),
        );
        result.status = filled ? "would fill" : "nothing to fill";
        result.fields = filled?.fields;
        if (filled && options.apply) {
          result.status = "refused";
          await library.push([{ key: `article/${id}`, value: filled.value }]);
          result.status = "filled";
        }
        if (options.apply) {
          done[id] = result.status;
          writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2), {
            mode: 0o600,
          });
          renameSync(`${stateFile}.tmp`, stateFile);
        }
      } catch (error) {
        result.error = await refusal(error);
      } finally {
        results.push(result);
        options.onResult?.(result);
      }
    }
  } finally {
    await reader.close();
  }
  return { candidates: candidates.length, results };
}

/** One line for a backfill result. */
export function describePreview(result: PreviewResult) {
  const detail = result.error
    ? `· ${result.error}`
    : result.fields
      ? `· ${Object.entries(result.fields)
          .map(([name, value]) => `${name}: ${value}`)
          .join(" · ")}`
      : "";
  return [result.status.padEnd(15), result.url, detail]
    .filter(Boolean)
    .join(" ");
}

/** One line for a result, as `wb arctic` prints it. */
export function describe(result: LinkResult) {
  const words = (count?: number) =>
    count === undefined ? "" : ` (${count.toLocaleString("en")} words)`;
  const text =
    result.text === "uploaded"
      ? `text: ${result.words!.toLocaleString("en")} words`
      : result.text === "kept"
        ? `text: ${result.reason === "has text" ? "has text" : "kept the longer copy"}${words(result.words)}`
        : result.text === "none"
          ? `no text: ${result.reason}${words(result.words)}`
          : "";
  const preview = result.preview
    ? `· preview: ${result.preview.join(", ")}`
    : result.previewError && `· no preview: ${result.previewError}`;
  return [
    result.status.padEnd(14),
    result.url ?? JSON.stringify(result.input),
    result.error ? `· ${result.error}` : text && `· ${text}`,
    !result.error && preview,
  ]
    .filter(Boolean)
    .join(" ");
}
