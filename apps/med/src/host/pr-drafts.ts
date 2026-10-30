import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MAX_PROMPT_IMAGE_BYTES } from "../shared/agent-inbox";
import { pullRequestUrlSchema, type SavedPrDraft } from "../shared/saved-review";
import { HostError } from "./runtime/errors";
import { git, ProcessFailure, runProcess } from "./runtime/process";

/**
 * Pull request drafts (docs/AGENT_INTEGRATION.md#draft-a-pull-request). An
 * agent writes the description in Markdown from the repository's template
 * and runs `med pr draft`; the review keeps the text, and this folder keeps a
 * copy of each local image it shows, by the hash of its bytes. Med opens the
 * pull request only when the reader clicks Create, with `gh pr create`, and
 * never pushes: the branch must be on GitHub already.
 */
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;
const FILE = /^[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;
export const MAX_PR_DRAFT_IMAGES = 8;
/** The request that carries a draft: its text and its images in base64. */
export const MAX_PR_DRAFT_BODY = 64 * 1024 * 1024;

export const prDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536),
  repo: z.string().min(1).max(4096).optional(),
  base: z
    .string()
    .regex(/^[\w./-]{1,255}$/)
    .optional(),
  /** The local images of the Markdown, by the href that it gives each one. */
  images: z
    .array(
      z.object({
        href: z.string().min(1).max(4096),
        mimeType: z.enum(Object.keys(IMAGE_TYPES) as [keyof typeof IMAGE_TYPES]),
        data: z
          .string()
          .max(Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      }),
    )
    .max(MAX_PR_DRAFT_IMAGES)
    .default([]),
});
export type PrDraftInput = z.input<typeof prDraftInputSchema>;

/** Markdown images, `![alt](href "title")`, and HTML ones, `<img src="href">`. */
const IMAGES =
  /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g;

/** The hrefs of the images that the Markdown shows, in order. */
export function imageHrefs(markdown: string) {
  return [...markdown.matchAll(IMAGES)].map((match) => match[2] ?? match[3]!);
}

/**
 * The body for GitHub: an image that is a local file becomes a line that
 * names it, because GitHub takes images only as links and gh cannot upload
 * one. The reader adds those on GitHub.
 */
export function gitHubBody(draft: Pick<SavedPrDraft, "body" | "images">) {
  const local = new Set(draft.images.map((image) => image.href));
  const left: string[] = [];
  const body = draft.body.replace(IMAGES, (whole, alt: string | undefined, href, src) => {
    const target = (href ?? src) as string;
    if (!local.has(target)) return whole;
    const name = alt?.trim() || target.split("/").at(-1)!;
    left.push(name);
    return `_Image: ${name} (added on GitHub)_`;
  });
  return { body, left };
}

export function createPrDrafts(options: {
  directory: string;
  gh: { command: string; args: string[] };
}) {
  const folder = (reviewId: string) => join(options.directory, reviewId);
  return {
    /** Keeps the draft's images and returns the draft to save. */
    async prepare(
      reviewId: string,
      input: z.output<typeof prDraftInputSchema>,
    ): Promise<Omit<SavedPrDraft, "revision" | "updatedAt" | "pullRequestUrl">> {
      const shown = new Set(imageHrefs(input.body));
      const images: SavedPrDraft["images"] = [];
      await mkdir(folder(reviewId), { recursive: true, mode: 0o700 });
      for (const image of input.images) {
        if (!shown.has(image.href)) continue;
        const bytes = Buffer.from(image.data, "base64");
        if (bytes.length > MAX_PROMPT_IMAGE_BYTES)
          throw new HostError("image-too-large", "An image can be up to 5 MB.", 413);
        const file = `${createHash("sha256").update(bytes).digest("hex")}.${IMAGE_TYPES[image.mimeType]}`;
        await writeFile(join(folder(reviewId), file), bytes, { mode: 0o600 });
        images.push({ href: image.href, file });
      }
      return {
        title: input.title,
        body: input.body,
        ...(input.repo ? { repo: input.repo } : {}),
        ...(input.base ? { base: input.base } : {}),
        images,
      };
    },
    /** An image of a review's draft, by its file name. */
    async image(reviewId: string, file: string) {
      if (!FILE.test(file) || !/^[A-Za-z0-9_-]+$/.test(reviewId))
        throw new HostError("invalid-image", "No such image.", 404);
      const bytes = await readFile(join(folder(reviewId), file)).catch(() => {
        throw new HostError("invalid-image", "No such image.", 404);
      });
      const extension = file.split(".")[1]!;
      const mime = Object.entries(IMAGE_TYPES).find(([, value]) => value === extension)![0];
      return { bytes, mime };
    },
    /**
     * Opens the pull request with `gh pr create` in the draft's checkout,
     * from its branch, which must be on GitHub already. Returns its URL and
     * the local images that GitHub did not get.
     */
    async create(draft: SavedPrDraft, repo: string, asDraft: boolean, signal?: AbortSignal) {
      const head = (
        await git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          signal,
          acceptedExitCodes: [0, 1],
        })
      )
        .toString()
        .trim();
      if (!head)
        throw new HostError(
          "no-branch",
          "The checkout is on no branch. Check out the branch to open the pull request from.",
          409,
        );
      // The pull request opens from the branch that the remote holds, so it
      // must hold every commit of the checkout's branch.
      const [upstream = "", remote = "", branch = ""] = (
        await git(
          repo,
          [
            "for-each-ref",
            "--format=%(upstream)%00%(upstream:remotename)%00%(upstream:lstrip=3)",
            `refs/heads/${head}`,
          ],
          { signal },
        )
      )
        .toString()
        .trim()
        .split("\0");
      if (!upstream.startsWith("refs/remotes/") || !remote || remote === "." || !branch)
        throw new HostError(
          "branch-not-pushed",
          `Push ${head} to GitHub first, such as with git push -u origin ${head}. Med does not push.`,
          409,
        );
      const ahead = Number(
        (await git(repo, ["rev-list", "--count", `${upstream}..refs/heads/${head}`], { signal }))
          .toString()
          .trim(),
      );
      if (ahead > 0)
        throw new HostError(
          "branch-not-pushed",
          `Push ${head} first: GitHub does not have its last ${ahead === 1 ? "commit" : `${ahead} commits`}. Med does not push.`,
          409,
        );
      const { body, left } = gitHubBody(draft);
      const scratch = join(tmpdir(), `med-pr-${process.pid}-${Date.now()}.md`);
      await writeFile(scratch, body, { mode: 0o600 });
      try {
        const { stdout } = await runProcess(
          options.gh.command,
          [
            ...options.gh.args,
            "pr",
            "create",
            "--title",
            draft.title,
            "--body-file",
            scratch,
            "--head",
            branch,
            ...(draft.base ? ["--base", draft.base] : []),
            ...(asDraft ? ["--draft"] : []),
          ],
          {
            cwd: repo,
            signal,
            timeoutMs: 60_000,
            env: { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
          },
        );
        const url = pullRequestUrlSchema.safeParse(stdout.toString().trim().split("\n").at(-1));
        if (!url.success)
          throw new HostError("pr-create-failed", "gh did not print the pull request's URL.", 502);
        return { url: url.data, left };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new HostError(
            "gh-missing",
            "Install the GitHub CLI (gh), then sign in with gh auth login.",
            502,
          );
        // A pull request that gh finds open already, as when Create ran
        // while the window closed, is the one this draft opened.
        const open =
          error instanceof ProcessFailure && /already exists/.test(error.stderr ?? "")
            ? pullRequestUrlSchema.safeParse(error.stderr.match(/https:\/\/\S+\/pull\/\d+/)?.[0])
            : undefined;
        if (open?.success) return { url: open.data, left };
        if (error instanceof ProcessFailure)
          throw new HostError(
            "pr-create-failed",
            (error.stderr || error.message).trim().split("\n").slice(-3).join(" "),
            502,
          );
        throw error;
      } finally {
        await rm(scratch, { force: true });
      }
    },
  };
}
