import { serveMedia, mediaHeaders } from "./media";
import { mediaType } from "../shared/media";
import { fileChangesRequestSchema } from "../shared/file-changes";
import { fileChanges } from "./repository/file-changes";
import { markdownAsset } from "./markdown-assets";
import { browseSourceSchema } from "../shared/browse";
import { LocalFiles } from "./local-files";
import { localPathSchema } from "../shared/local-file";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve, relative, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  notesRequestSchema,
  noteMutationSchema,
  reviewRequestSchema,
  type ChangeEvent,
  type Comparison,
  type Repository,
  type Session,
} from "../shared/protocol";
import { gitTargets, pushBranch } from "./repository/git-actions";
import { pushRequestSchema } from "../shared/git-actions";
import { loadHistory, resolveRepository } from "./repository/history";
import { ReviewService } from "./repository/review";
import { HostError } from "./runtime/errors";
import { ProcessFailure } from "./runtime/process";
import { watchRepository } from "./runtime/watch";
import { NoteService } from "./notes";
import {
  browseListRequestSchema,
  browseReadRequestSchema,
  browseWriteRequestSchema,
} from "../shared/browse";
import { listBrowse, readBrowse, writeBrowse } from "./repository/browse";
import { browseBlameRequestSchema, browseSearchRequestSchema } from "../shared/inspect";
import { blameBrowse } from "./repository/inspect";
import { symbolSearchRequestSchema } from "../shared/symbols";
import { FileSymbolService } from "./search/symbols";
import { type SearchOptions } from "./search/service";
import { RepositoryRegistry } from "./repository/registry";
import { SavedReviewStore } from "./saved-reviews";
import { savedReviewCreateSchema } from "../shared/saved-review";
import { getPersistentToken, publishConnection } from "./runtime/connection";

import type { ServiceManager } from "./service/manager";

export interface StartHostOptions {
  service?: ServiceManager;
  assets?: (path: string) => Promise<Uint8Array | undefined>;
  repo: string;
  fileMode?: boolean;
  repos?: readonly string[];
  port?: number;
  open?: boolean;
  webRoot?: string;
  initialComparison?: Comparison;
  allowedInputPaths?: readonly string[];
  onClose?: () => Promise<void>;
  search?: SearchOptions;
  stateDir?: string;
}
export interface RunningHost {
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}
const MAX_BODY = 128 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

async function readBody(request: IncomingMessage, limit = MAX_BODY) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const data of request) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    bytes += chunk.byteLength;
    if (bytes > limit)
      throw new HostError("payload-too-large", "The request body exceeds its size limit.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HostError("invalid-json", "The request body must be JSON.");
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

/** Serve one local review process; Git operations never change the checkout. */
export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  let repository: Repository;
  try {
    if (options.service) throw new Error("Managed sources use an explicit catalogue.");
    repository = { ...(await resolveRepository(resolve(options.repo))), git: true };
  } catch (error) {
    if (
      !options.fileMode &&
      options.initialComparison?.kind !== "patch" &&
      options.initialComparison?.kind !== "files"
    )
      throw error;
    const path = await realpath(resolve(options.repo));
    if (!(await stat(path)).isDirectory())
      throw new HostError("invalid-directory", "Choose an input directory.");
    repository = {
      path,
      name: basename(path),
      head: "",
      branch: "File comparison",
      shallow: false,
      git: false,
    };
  }
  const token = options.stateDir
    ? await getPersistentToken(options.stateDir)
    : randomBytes(32).toString("base64url");
  const tokenDigest = createHash("sha256").update(token).digest();
  const reviews = new ReviewService(
    new Set((options.allowedInputPaths ?? []).map((path) => resolve(path))),
  );
  const notes = new NoteService(reviews);
  const symbols = new FileSymbolService();
  const localFiles = new LocalFiles();
  const temporaryState = options.stateDir
    ? undefined
    : await mkdtemp(join(tmpdir(), "med-reviews-"));
  const savedReviews = new SavedReviewStore(join(options.stateDir ?? temporaryState!, "reviews"));

  const watchers = new Map<string, Promise<() => Promise<void>>>();
  const watcherModes = new Map<string, boolean>();
  const browseLiveSources = new Set<string>();
  const retiringWatchers = new Set<Promise<void>>();
  const retireWatcher = (watcher: Promise<() => Promise<void>>) => {
    const stopped = watcher.then((stop) => stop()).catch(() => {});
    retiringWatchers.add(stopped);
    void stopped.finally(() => retiringWatchers.delete(stopped));
    return stopped;
  };
  const streams = new Map<ServerResponse, string>();
  const activeRequests = new Map<AbortController, Set<string>>();
  let revision = 0;
  let closing = false;
  let port = 0;
  let expensiveRequests = 0;
  const embeddedAssets =
    options.assets ?? (globalThis as { __medAssets?: StartHostOptions["assets"] }).__medAssets;
  const webRoot =
    options.webRoot ??
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      fileURLToPath(import.meta.url).includes("/dist/assets/") ? "../web" : "web",
    );

  const registry = new RepositoryRegistry(options.search, async (id, paths) => {
    for (const [abort, owners] of activeRequests) if (owners.has(id)) abort.abort();
    for (const [stream, path] of streams)
      if (paths.has(path)) {
        stream.end();
        streams.delete(stream);
      }
    for (const path of paths) {
      const watcher = watchers.get(path);
      watchers.delete(path);
      watcherModes.delete(path);
      browseLiveSources.delete(path);
      if (watcher) await retireWatcher(watcher);
    }
    reviews.removeRepositories(paths);
    notes.removeRepositories(paths);
  });
  if (repository.git !== false) {
    await registry.register(repository.path);
    for (const path of options.repos ?? []) await registry.register(path);
  }
  await options.service?.attach(registry);
  const publish = (event: ChangeEvent) => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [stream, path] of streams) {
      if (path !== event.repo) continue;
      if (stream.writableLength > 256 * 1024) {
        stream.destroy();
        streams.delete(stream);
      } else stream.write(frame);
    }
  };
  const observe = (repo: string, live = false) => {
    if (closing) return;
    if (watchers.has(repo) && watcherModes.get(repo) === live) {
      const current = watchers.get(repo)!;
      watchers.delete(repo);
      watchers.set(repo, current);
      return;
    }
    let evicted: Promise<void> | undefined;
    if (!watchers.has(repo) && watchers.size >= 8) {
      const pinned = new Set(streams.values());
      const oldest = [...watchers.keys()].find((path) => !pinned.has(path));
      if (!oldest)
        throw new HostError(
          "too-many-watchers",
          "Eight working folders are in use. Close another viewer before opening this source.",
          503,
        );
      const stop = watchers.get(oldest)!;
      watchers.delete(oldest);
      watcherModes.delete(oldest);
      browseLiveSources.delete(oldest);
      evicted = retireWatcher(stop);
    }
    const previous = watchers.get(repo);
    const promise = (async () => {
      await evicted;
      if (previous) {
        try {
          await (
            await previous
          )();
        } catch {
          /* Replace a failed watcher. */
        }
      }
      return watchRepository(
        repo,
        () => {
          if (!registry.owner(repo)) return;
          registry.refreshSearch(repo);
          publish({ type: "changed", repo, revision: ++revision });
        },
        live,
      );
    })();
    watchers.set(repo, promise);
    watcherModes.set(repo, live);
    promise.catch(() => {
      if (watchers.get(repo) === promise) {
        watchers.delete(repo);
        watcherModes.delete(repo);
      }
    });
  };
  const session = async (repo: string, signal?: AbortSignal): Promise<Session> => {
    if (repository.git === false && !options.service)
      return {
        protocol: 1,
        repository,
        worktrees: [],
        repositories: [],
        ...(options.initialComparison ? { initialComparison: options.initialComparison } : {}),
      };
    await registry.refreshOwner(repo, signal);
    const repositories = registry.snapshot();
    const owner = await registry.require(repo, signal);
    const info = await resolveRepository(repo, signal);
    observe(info.path, watcherModes.get(info.path) ?? false);
    return {
      protocol: 1,
      repository: { ...info, git: true },
      repositoryId: owner.repository.id,
      repositories,
      worktrees: owner.repository.worktrees,
      ...(options.initialComparison && repo === repository.path
        ? { initialComparison: options.initialComparison }
        : {}),
    };
  };

  const server = createServer((request, response) => {
    const abort = new AbortController();
    const owners = new Set<string>();
    const ownershipChecks = new Set<() => boolean>();
    activeRequests.set(abort, owners);
    const requireRepo = async (input: string | null) => {
      if (repository.git === false && !options.service) {
        const path = resolve(input ?? repository.path);
        if (path !== repository.path && path !== resolve(options.repo))
          throw new HostError("repository-not-allowed", "Choose the input directory.", 403);
        return repository.path;
      }
      const fallback = registry.owner(repository.path)?.path ?? registry.snapshot()[0]?.path;
      if (!input && !fallback)
        throw new HostError("repository-not-allowed", "Add a repository to continue.", 403);
      const owned = await registry.require(input ?? fallback!, abort.signal);
      owners.add(owned.repository.id);
      ownershipChecks.add(owned.valid);
      return owned.path;
    };
    const requireReview = async (id: string) => {
      await requireRepo(reviews.get(id).response.repo);
      return id;
    };
    const assertRequestAccess = () => {
      abort.signal.throwIfAborted();
      if ([...ownershipChecks].some((valid) => !valid()))
        throw new HostError(
          "repository-not-allowed",
          "This repository was removed during the request.",
          403,
        );
    };
    const captureImages = async (review: Awaited<ReturnType<typeof reviews.load>>) => {
      const images: { path: string; side: "old" | "new"; mime: string; data: string }[] = [];
      let bytes = Buffer.byteLength(review.patch);
      for (const file of review.files) {
        if (mediaType(file.path)?.kind !== "image") continue;
        for (const side of ["old", "new"] as const) {
          if ((side === "old" && file.status === "A") || (side === "new" && file.status === "D"))
            continue;
          try {
            const image = await reviews.image(review.id, file.path, side, abort.signal);
            bytes += image.bytes.length;
            if (bytes > 24 * 1024 * 1024)
              throw new HostError(
                "saved-review-too-large",
                "Captured media exceeds 24 MiB. Narrow this review.",
                413,
              );
            images.push({
              path: file.path,
              side,
              mime: image.mime,
              data: image.bytes.toString("base64"),
            });
          } catch (error) {
            if (
              error instanceof HostError &&
              ["image-unavailable", "unsupported-media"].includes(error.code)
            )
              continue;
            throw error;
          }
        }
      }
      return images;
    };
    const send = (body: unknown) => {
      assertRequestAccess();
      json(response, 200, body);
    };
    request.once("aborted", () => abort.abort());
    response.once("close", () => {
      if (!response.writableEnded) abort.abort();
    });
    void (async () => {
      const host = request.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        throw new HostError("forbidden-host", "The local host header is not valid.", 403);
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        if (request.headers.origin && request.headers.origin !== `http://${host}`)
          throw new HostError(
            "forbidden-origin",
            "Use the same local origin for API requests.",
            403,
          );
        const bearer = request.headers.authorization?.replace(/^Bearer /, "");
        const cookie = request.headers.cookie
          ?.split(";")
          .map((entry) => entry.trim())
          .find((entry) => entry.startsWith(`med_session_${port}=`))
          ?.slice(`med_session_${port}=`.length);
        const provided = bearer ?? (url.pathname === "/api/auth" ? "" : cookie) ?? "";
        if (!timingSafeEqual(tokenDigest, createHash("sha256").update(provided).digest()))
          throw new HostError("unauthorized", "Open the launch URL with its access token.", 401);
        if (url.pathname === "/api/auth" && request.method === "POST") {
          response.setHeader(
            "Set-Cookie",
            `med_session_${port}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
          );
          send({ authenticated: true });
          return;
        }
        if (url.pathname === "/api/events" && request.method === "GET") {
          const eventRepo = await requireRepo(url.searchParams.get("repo"));
          if (streams.size >= 8)
            throw new HostError("too-many-streams", "Too many review event streams are open.", 503);
          if (registry.owner(eventRepo)) observe(eventRepo, watcherModes.get(eventRepo) ?? false);
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          response.write(
            `event: ready\ndata: ${JSON.stringify({ type: "ready", repo: eventRepo, revision })}\n\n`,
          );
          streams.set(response, eventRepo);
          response.once("close", () => streams.delete(response));
          return;
        }
        if (expensiveRequests >= 8)
          throw new HostError("busy", "The host is processing other requests. Retry shortly.", 503);
        expensiveRequests++;
        try {
          if (
            options.service &&
            url.pathname.startsWith("/api/service/") &&
            request.method === "POST"
          ) {
            const action = url.pathname.slice("/api/service/".length);
            const result = await options.service.request(action, await readBody(request));
            if (action === "read") {
              const file = result as { path: string; vault: { id: string; path: string } };
              send({ ...(await localFiles.open(file.path, abort.signal)), vault: file.vault });
            } else send(result);
            return;
          }
          if (options.service && url.pathname === "/api/vault/image" && request.method === "GET") {
            const image = await options.service.image(
              z.string().min(1).parse(url.searchParams.get("document")),
              z.string().min(1).parse(url.searchParams.get("href")),
              url.searchParams.get("syntax") === "markdown" ? "markdown" : "wiki",
            );
            response.writeHead(200, {
              "Content-Type": image.mime,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
            });
            response.end(image.bytes);
            return;
          }
          if (url.pathname === "/api/reviews" && request.method === "POST") {
            if (repository.git === false && !options.service)
              throw new HostError(
                "git-required",
                "Start med with Git repositories to create a review.",
                422,
              );
            const input = savedReviewCreateSchema.parse(await readBody(request));
            send(
              await savedReviews.create(
                input,
                async (target) => {
                  const repo = await requireRepo(target.repo);
                  const owner = await registry.require(repo, abort.signal);
                  const info = await resolveRepository(repo, abort.signal);
                  const review = await reviews.load(
                    { repo, comparison: target.comparison },
                    abort.signal,
                  );
                  if (review.files.length > 500)
                    throw new HostError(
                      "saved-review-too-large",
                      "Narrow this review to at most 500 changed files per target.",
                      413,
                    );
                  const sources = [];
                  const images = await captureImages(review);
                  let sourceBytes =
                    Buffer.byteLength(review.patch) +
                    images.reduce((sum, image) => sum + Buffer.byteLength(image.data, "base64"), 0);
                  for (const file of review.files) {
                    if (mediaType(file.path)?.kind === "image") continue;
                    if (file.binary || file.tooLarge) continue;
                    try {
                      const source = await reviews.sources(review.id, file.path, abort.signal);
                      sourceBytes += Buffer.byteLength(source.old) + Buffer.byteLength(source.new);
                      if (sourceBytes > 24 * 1024 * 1024)
                        throw new HostError(
                          "saved-review-too-large",
                          "Narrow this review; captured source exceeds 24 MiB per target.",
                          413,
                        );
                      sources.push(source);
                    } catch (error) {
                      if (
                        error instanceof HostError &&
                        ["unsupported-source", "source-unavailable", "binary-source"].includes(
                          error.code,
                        )
                      )
                        continue;
                      throw error;
                    }
                  }
                  abort.signal.throwIfAborted();
                  if (!owner.valid())
                    throw new HostError(
                      "repository-not-allowed",
                      "The repository was removed during capture.",
                      403,
                    );
                  return {
                    repositoryId: owner.repository.id,
                    repo,
                    branch: info.branch === "Detached HEAD" ? null : info.branch,
                    review,
                    sources,
                    images,
                  };
                },
                assertRequestAccess,
              ),
            );
            return;
          }
          const browsingNotes = /^\/api\/reviews\/([^/]+)\/browsing\/([a-f0-9]{64})\/notes$/.exec(
            url.pathname,
          );
          if (browsingNotes) {
            const [, id, reviewId] = browsingNotes;
            const bundle = await savedReviews.get(id!);
            const target = bundle.targets.find((item) => item.commentReviewId === reviewId);
            if (target) {
              const family = registry.snapshot().find((item) => item.id === target.repositoryId);
              if (!family)
                throw new HostError(
                  "repository-unavailable",
                  "Register the repository to open these comments.",
                  409,
                );
              const repo = await requireRepo(family.path);
              if (
                (await registry.require(repo, abort.signal)).repository.id !== target.repositoryId
              )
                throw new HostError(
                  "repository-changed",
                  "This comment belongs to another repository.",
                  409,
                );
            } else {
              await requireReview(reviewId!);
            }
            if (request.method === "GET") {
              const state = target
                ? await savedReviews.notes(id!, target.id)
                : { reviewId: reviewId!, revision: 0, notes: [] };
              send({ ...state, reviewId });
              return;
            }
            if (request.method !== "POST")
              throw new HostError("method-not-allowed", "Use GET or POST for comments.", 405);
            const input = notesRequestSchema.parse(await readBody(request));
            if (input.reviewId !== reviewId)
              throw new HostError("invalid-note", "The comment comparison does not match.", 409);
            const state = await savedReviews.mutate(
              id!,
              target?.id ?? reviewId!,
              input.expectedRevision,
              input.mutation,
              assertRequestAccess,
              target
                ? undefined
                : async () => {
                    const review = reviews.get(await requireReview(reviewId!)).response;
                    if (review.comparison.kind === "files" || review.comparison.kind === "patch")
                      throw new HostError(
                        "git-required",
                        "Saved comments require a Git comparison.",
                        422,
                      );
                    const owner = await registry.require(review.repo, abort.signal);
                    const info = await resolveRepository(review.repo, abort.signal);
                    if (review.files.length > 500)
                      throw new HostError(
                        "saved-review-too-large",
                        "Narrow this comparison to at most 500 changed files.",
                        413,
                      );
                    const sources = [];
                    const images = await captureImages(review);
                    let bytes =
                      Buffer.byteLength(review.patch) +
                      images.reduce(
                        (sum, image) => sum + Buffer.byteLength(image.data, "base64"),
                        0,
                      );
                    for (const file of review.files) {
                      if (mediaType(file.path)?.kind === "image") continue;
                      if (file.binary || file.tooLarge) continue;
                      let source;
                      try {
                        source = await reviews.sources(reviewId!, file.path, abort.signal);
                      } catch (error) {
                        if (
                          error instanceof HostError &&
                          ["unsupported-source", "source-unavailable", "binary-source"].includes(
                            error.code,
                          )
                        )
                          continue;
                        throw error;
                      }
                      bytes += Buffer.byteLength(source.old) + Buffer.byteLength(source.new);
                      if (bytes > 24 * 1024 * 1024)
                        throw new HostError(
                          "saved-review-too-large",
                          "Comment context exceeds 24 MiB. Narrow this comparison.",
                          413,
                        );
                      sources.push(source);
                    }
                    assertRequestAccess();
                    return {
                      repositoryId: owner.repository.id,
                      repo: review.repo,
                      branch: info.branch === "Detached HEAD" ? null : info.branch,
                      review,
                      sources,
                      images,
                    };
                  },
            );
            send({ ...state, reviewId });
            return;
          }
          const savedRoute =
            /^\/api\/reviews\/([^/]+)(?:\/targets\/([^/]+)\/(review|source|notes)|\/(feedback|clear))?$/.exec(
              url.pathname,
            );
          if (savedRoute) {
            const [, id, targetId, targetAction, action] = savedRoute;
            const bundle = await savedReviews.get(id!);
            // Saved data does not grant access to an unregistered repository family.
            const relevant = targetId
              ? bundle.targets.filter((target) => target.id === targetId)
              : !action && request.method === "GET"
                ? []
                : bundle.targets;
            if (targetId && !relevant.length)
              throw new HostError("target-not-found", "This review target does not exist.", 404);
            for (const target of relevant) {
              const entry = registry.snapshot().find((entry) => entry.id === target.repositoryId);
              if (!entry)
                throw new HostError(
                  "repository-unavailable",
                  `Register the repository for ${target.repo} to open this saved review.`,
                  409,
                );
              const available = await requireRepo(entry.path);
              const owner = await registry.require(available, abort.signal);
              if (owner.repository.id !== target.repositoryId)
                throw new HostError(
                  "repository-changed",
                  "This saved review belongs to another repository.",
                  409,
                );
            }
            if (request.method === "GET") {
              if (targetAction === "review") send(await savedReviews.review(id!, targetId!));
              else if (targetAction === "source")
                send(await savedReviews.source(id!, targetId!, url.searchParams.get("path") ?? ""));
              else if (targetAction === "notes") send(await savedReviews.notes(id!, targetId!));
              else if (action === "feedback") send(await savedReviews.feedback(id!));
              else if (!action) send(bundle);
              else throw new HostError("method-not-allowed", "Use POST to clear comments.", 405);
              return;
            }
            if (request.method === "POST" && targetAction === "notes") {
              const input = z
                .object({
                  expectedRevision: z.number().int().nonnegative(),
                  mutation: noteMutationSchema,
                })
                .parse(await readBody(request));
              assertRequestAccess();
              send(
                await savedReviews.mutate(
                  id!,
                  targetId!,
                  input.expectedRevision,
                  input.mutation,
                  assertRequestAccess,
                ),
              );
              return;
            }
            if (request.method === "POST" && action === "clear") {
              const input = z
                .object({ expectedRevision: z.number().int().nonnegative() })
                .parse(await readBody(request));
              assertRequestAccess();
              send(await savedReviews.clear(id!, input.expectedRevision, assertRequestAccess));
              return;
            }
            throw new HostError(
              "method-not-allowed",
              "This saved review action is not supported.",
              405,
            );
          }
          if (url.pathname === "/api/session" && request.method === "GET") {
            send(await session(await requireRepo(url.searchParams.get("repo")), abort.signal));
            return;
          }
          if (url.pathname === "/api/notes" && request.method === "GET") {
            send(notes.get(await requireReview(url.searchParams.get("reviewId") ?? "")));
            return;
          }
          if (url.pathname === "/api/repositories") {
            if (repository.git === false && !options.service) {
              if (request.method === "GET") {
                send({ repositories: [] });
                return;
              }
              throw new HostError(
                "file-only-session",
                "Open a Git session to manage repositories.",
                422,
              );
            }
            if (request.method === "GET") {
              send({ repositories: await registry.list(abort.signal) });
              return;
            }
            if (request.method === "POST") {
              const input = z
                .object({ path: z.string().min(1).max(8192) })
                .parse(await readBody(request));
              if (options.service)
                await options.service.request("add", { path: input.path, kind: "repo" });
              else await registry.register(input.path, abort.signal);
              send({ repositories: registry.snapshot() });
              return;
            }
            if (request.method === "DELETE") {
              const id = url.searchParams.get("id") ?? "";
              const entry = registry.snapshot().find((item) => item.id === id);
              if (options.service && entry) {
                const saved = options.service.sources
                  .list()
                  .find(
                    (source) => source.kind === "repo" && registry.owner(source.path)?.id === id,
                  );
                if (!saved)
                  throw new HostError(
                    "repository-not-found",
                    "This repository is not registered.",
                    404,
                  );
                await options.service.request("remove", { source: saved.id });
                send({ repositories: registry.snapshot() });
              } else send({ repositories: await registry.remove(id) });
              return;
            }
          }
          if (url.pathname === "/api/media" && ["GET", "HEAD"].includes(request.method ?? "")) {
            const path = z.string().min(1).max(4096).parse(url.searchParams.get("path"));
            const raw = JSON.parse(url.searchParams.get("source") ?? "null");
            let source,
              mediaPath = path;
            if (raw?.kind === "local") {
              if (raw.path !== path)
                throw new HostError("invalid-path", "File path does not match.", 400);
              const resolved = await localFiles.mediaSource(path);
              source = resolved.source;
              mediaPath = resolved.path;
            } else {
              source = browseSourceSchema.parse(raw);
              source.repo = await requireRepo(source.repo);
            }
            assertRequestAccess();
            await serveMedia(
              response,
              source,
              mediaPath,
              url.searchParams.get("identity"),
              request.headers.range,
              request.method === "HEAD",
              abort.signal,
              assertRequestAccess,
            );
            return;
          }
          if (url.pathname === "/api/review-image" && request.method === "GET") {
            const path = z.string().min(1).max(4096).parse(url.searchParams.get("path"));
            const side = z.enum(["old", "new"]).parse(url.searchParams.get("side"));
            let image;
            const saved = url.searchParams.get("saved");
            if (saved) {
              const targetId = url.searchParams.get("target") ?? "";
              const savedImage = await savedReviews.image(saved, targetId, path, side);
              const family = registry
                .snapshot()
                .find((item) => item.id === savedImage.repositoryId);
              if (!family)
                throw new HostError(
                  "repository-unavailable",
                  "Register this review's repository to view its images.",
                  409,
                );
              await requireRepo(family.path);
              image = savedImage;
            } else {
              const reviewId = await requireReview(url.searchParams.get("reviewId") ?? "");
              image = await reviews.image(reviewId, path, side, abort.signal);
            }
            assertRequestAccess();
            response.writeHead(200, {
              ...mediaHeaders,
              "Content-Type": image.mime,
              "Content-Length": image.bytes.length,
            });
            response.end(image.bytes);
            return;
          }
          if (url.pathname === "/api/markdown/image" && request.method === "GET") {
            const document = z.string().min(1).max(4096).parse(url.searchParams.get("document"));
            const href = z.string().min(1).max(4096).parse(url.searchParams.get("href"));
            const rawSource = JSON.parse(url.searchParams.get("source") ?? "null");
            let image;
            if (rawSource?.kind === "local") {
              const path = localPathSchema.parse(rawSource.path);
              if (path !== document)
                throw new HostError("invalid-image", "Document path does not match.", 400);
              image = await localFiles.image(path, href, abort.signal);
            } else {
              const source = browseSourceSchema.parse(rawSource);
              source.repo = await requireRepo(source.repo);
              image = await markdownAsset(source, document, href, abort.signal);
            }
            response.writeHead(200, {
              "Content-Type": image.mime,
              "Content-Length": image.bytes.length,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            });
            response.end(image.bytes);
            return;
          }
          if (url.pathname === "/api/local-files/open" && request.method === "POST") {
            const input = z.object({ path: localPathSchema }).parse(await readBody(request));
            send(await localFiles.open(input.path, abort.signal));
            return;
          }
          if (url.pathname === "/api/local-files/write" && request.method === "POST") {
            const input = z
              .object({
                path: localPathSchema,
                expectedIdentity: z.string().min(1).max(8192),
                text: z.string().max(1024 * 1024),
              })
              .parse(await readBody(request, 8 * 1024 * 1024));
            send(await localFiles.write(input.path, input.expectedIdentity, input.text));
            return;
          }
          if (url.pathname === "/api/browse/changes" && request.method === "POST") {
            const input = fileChangesRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            let comparison;
            if (input.saved) {
              const { id, target } = input.saved;
              const bundle = await savedReviews.get(id);
              const saved = bundle.targets.find((entry) => entry.id === target);
              const owner = await registry.require(input.source.repo, abort.signal);
              if (!saved || saved.repositoryId !== owner.repository.id)
                throw new HostError(
                  "invalid-source",
                  "The saved comparison belongs to another repository.",
                  403,
                );
              comparison = {
                review: await savedReviews.review(id, target),
                source: (path: string) => savedReviews.source(id, target, path),
              };
            } else if (input.reviewId) {
              await requireReview(input.reviewId);
              comparison = {
                review: reviews.get(input.reviewId).response,
                source: (path: string) => reviews.sources(input.reviewId!, path, abort.signal),
              };
            }
            send(
              await fileChanges(input.source, input.path, input.identity, comparison, abort.signal),
            );
            return;
          }
          if (url.pathname === "/api/browse/list" && request.method === "POST") {
            const input = browseListRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            if (input.source.kind === "worktree") {
              browseLiveSources.add(input.source.repo);
              observe(input.source.repo, true);
            }
            send(await listBrowse(input.source, input.ignored, abort.signal));
            return;
          }
          if (url.pathname === "/api/browse/write" && request.method === "POST") {
            const input = browseWriteRequestSchema.parse(await readBody(request, 8 * 1024 * 1024));
            input.source.repo = await requireRepo(input.source.repo);
            send(
              await writeBrowse(
                input.source,
                input.path,
                input.expectedIdentity,
                input.text,
                assertRequestAccess,
              ),
            );
            return;
          }
          if (url.pathname === "/api/browse/read" && request.method === "POST") {
            const input = browseReadRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            if (input.source.kind === "worktree") {
              browseLiveSources.add(input.source.repo);
              observe(input.source.repo, true);
            }
            send(await readBrowse(input.source, input.path, abort.signal));
            return;
          }
          if (url.pathname === "/api/browse/symbols" && request.method === "POST") {
            const input = symbolSearchRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            send(
              input.path
                ? await symbols.search(input, abort.signal)
                : await registry.withSearch(input.source.repo, (search) =>
                    search.symbols(input.source, input.query, abort.signal),
                  ),
            );
            return;
          }
          if (url.pathname === "/api/browse/search" && request.method === "POST") {
            const input = browseSearchRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            send(
              await registry.withSearch(input.source.repo, (search) =>
                search.search(input.source, input.query, abort.signal),
              ),
            );
            return;
          }
          if (url.pathname === "/api/search/status" && request.method === "GET") {
            const repo = await requireRepo(url.searchParams.get("repo"));
            send(
              repository.git === false && !options.service
                ? { state: "unavailable", message: "This is a file comparison.", branches: [] }
                : await registry.withSearch(repo, (search) => search.status()),
            );
            return;
          }
          if (url.pathname === "/api/browse/blame" && request.method === "POST") {
            const input = browseBlameRequestSchema.parse(await readBody(request));
            input.source.repo = await requireRepo(input.source.repo);
            send(await blameBrowse(input, abort.signal));
            return;
          }
          if (url.pathname === "/api/git/targets" && request.method === "GET") {
            send(await gitTargets(await requireRepo(url.searchParams.get("repo")), abort.signal));
            return;
          }
          if (url.pathname === "/api/git/push" && request.method === "POST") {
            const input = pushRequestSchema.parse(await readBody(request));
            input.repo = await requireRepo(input.repo);
            send(await pushBranch(input, abort.signal));
            return;
          }
          if (url.pathname === "/api/branches" && request.method === "GET") {
            const repo = await requireRepo(url.searchParams.get("repo"));
            if (repository.git === false && !options.service) {
              send([]);
              return;
            }
            await registry.refreshOwner(repo, abort.signal);
            send((await registry.require(repo, abort.signal)).repository.branches);
            return;
          }
          if (url.pathname === "/api/history" && request.method === "GET") {
            if (repository.git === false && !options.service) {
              send({ commits: [], cursor: null, hasMore: false });
              return;
            }
            send(
              await loadHistory(
                await requireRepo(url.searchParams.get("repo")),
                url.searchParams.get("cursor"),
                Number(url.searchParams.get("limit") ?? 50),
                abort.signal,
                url.searchParams.get("ref") ?? undefined,
              ),
            );
            return;
          }
          if (url.pathname === "/api/review" && request.method === "POST") {
            const input = reviewRequestSchema.parse(await readBody(request));
            input.repo = await requireRepo(input.repo);
            if (
              repository.git === false &&
              !options.service &&
              input.comparison.kind !== "patch" &&
              input.comparison.kind !== "files"
            )
              throw new HostError(
                "not-a-git-repository",
                "This directory supports patch and file inputs only.",
                422,
              );
            if (repository.git !== false || options.service)
              observe(
                input.repo,
                browseLiveSources.has(input.repo) ||
                  input.comparison.kind === "working" ||
                  input.comparison.kind === "unstaged",
              );
            const review = await reviews.load(input, abort.signal);
            abort.signal.throwIfAborted();
            notes.adopt(review.id);
            send(review);
            return;
          }
          if (url.pathname === "/api/source" && request.method === "GET") {
            send(
              await reviews.sources(
                await requireReview(url.searchParams.get("reviewId") ?? ""),
                url.searchParams.get("path") ?? "",
                abort.signal,
              ),
            );
            return;
          }
          if (url.pathname === "/api/notes" && request.method === "POST") {
            const input = notesRequestSchema.parse(await readBody(request));
            send(
              await notes.mutate(
                await requireReview(input.reviewId),
                input.expectedRevision,
                input.mutation,
                abort.signal,
              ),
            );
            return;
          }
        } finally {
          expensiveRequests--;
        }
        throw new HostError("not-found", "This API route does not exist.", 404);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new HostError("method-not-allowed", "Use GET for application files.", 405);
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        throw new HostError("invalid-path", "This URL path is not valid.");
      }
      const appRoute =
        path === "/sources" ||
        path.startsWith("/vault/") ||
        path === "/file" ||
        path.startsWith("/file/") ||
        path === "/files" ||
        path === "/" ||
        /^\/review\/[a-zA-Z0-9_-]+$/.test(path);
      const file = resolve(webRoot, `.${appRoute ? "/index.html" : path}`);
      const rel = relative(webRoot, file);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new HostError("invalid-path", "This asset path is not valid.", 403);
      let data: Buffer;
      try {
        const embedded = await embeddedAssets?.(appRoute ? "/index.html" : path);
        if (embedded) data = Buffer.from(embedded);
        else {
          const info = await stat(file);
          if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error("not an asset");
          data = await readFile(file);
        }
      } catch {
        if (appRoute) {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(
            "<!doctype html><title>Med host</title><p>The review host is ready. Build the web application to serve its interface.</p>",
          );
          return;
        }
        throw new HostError("not-found", "This application asset does not exist.", 404);
      }
      response.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        // Build assets and fonts keep their content in their names. Browsers
        // revalidate the manifest and icons so an installed app sees updates.
        "cache-control":
          appRoute || path.endsWith(".html")
            ? "no-store"
            : path.startsWith("/assets/") || path.startsWith("/fonts/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(request.method === "HEAD" ? undefined : data);
    })()
      .catch((error: unknown) => {
        if (response.headersSent || response.destroyed) {
          response.destroy();
          return;
        }
        const cancelled = error instanceof Error && error.name === "AbortError";
        const status = cancelled
          ? 499
          : error instanceof HostError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : error instanceof ProcessFailure
                ? error.code === "output-too-large"
                  ? 413
                  : error.code === "cancelled"
                    ? 499
                    : 422
                : 500;
        const code = cancelled
          ? "cancelled"
          : error instanceof HostError || error instanceof ProcessFailure
            ? error.code
            : error instanceof z.ZodError
              ? "invalid-request"
              : "internal-error";
        const message =
          error instanceof Error ? error.message : "The host could not complete the request.";
        json(response, status, { error: { code, message } });
      })
      .finally(() => {
        activeRequests.delete(abort);
      });
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("The local server did not open a TCP port.");
  port = address.port;
  const clearConnection = options.stateDir
    ? await publishConnection(options.stateDir, {
        origin: `http://127.0.0.1:${port}`,
        token,
        pid: process.pid,
        version: 1,
      })
    : undefined;
  if (options.open) {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer.exe"
          : "xdg-open";
    const child = spawn(command, [`http://127.0.0.1:${port}/#token=${token}`], {
      stdio: "ignore",
      detached: true,
      shell: false,
    });
    child.on("error", () => {
      /* The caller still receives a usable launch URL. */
    });
    child.unref();
  }
  const heartbeat = setInterval(() => {
    for (const stream of streams.keys()) stream.write(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref();
  return {
    url: `http://127.0.0.1:${port}/${options.fileMode ? "files" : ""}#token=${token}`,
    token,
    port,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      for (const abort of activeRequests.keys()) abort.abort();
      for (const stream of streams.keys()) stream.end();
      streams.clear();
      await Promise.allSettled([...watchers.values()].map(async (stop) => (await stop)()));
      await Promise.allSettled(retiringWatchers);
      await options.service?.close();
      await registry.close();
      reviews.clear();
      notes.clear();
      await clearConnection?.();
      if (temporaryState) await rm(temporaryState, { recursive: true, force: true });
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections();
      });
      await options.onClose?.();
    },
  };
}
