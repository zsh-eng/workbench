import { basename, dirname, isAbsolute, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { readBrowse, writeBrowse } from "./repository/browse";
import { markdownAsset } from "./markdown-assets";
import { HostError } from "./runtime/errors";
import type { BrowseRead } from "../shared/browse";
import type { LocalRead } from "../shared/local-file";

/** File grants are exact paths. Opening a file does not register its parent. */
export class LocalFiles {
  private readonly opened = new Set<string>();
  private async canonical(path: string) {
    if (!isAbsolute(path) || path.includes("\0") || path.length > 4096)
      throw new HostError("invalid-path", "Use an absolute file path.", 400);
    const parent = await realpath(dirname(path));
    return resolve(parent, basename(path));
  }
  private result(path: string, read: BrowseRead): LocalRead {
    return { ...read, source: { kind: "local", path }, path };
  }
  async open(path: string, signal?: AbortSignal) {
    const canonical = await this.canonical(path);
    if (!this.opened.has(canonical) && this.opened.size >= 256)
      throw new HostError(
        "file-limit",
        "Restart the host to open more than 256 standalone files.",
        409,
      );
    const file = await readBrowse(
      { kind: "worktree", repo: dirname(canonical) },
      basename(canonical),
      signal,
    );
    if (file.kind === "text") this.opened.add(canonical);
    return this.result(canonical, file);
  }
  async image(path: string, href: string, signal?: AbortSignal) {
    const canonical = await this.canonical(path);
    if (canonical !== path || !this.opened.has(canonical))
      throw new HostError("file-not-open", "Open this document before loading its images.", 403);
    return markdownAsset({ kind: "worktree", repo: dirname(path) }, basename(path), href, signal);
  }
  async write(path: string, expectedIdentity: string, text: string) {
    const canonical = await this.canonical(path);
    const assertAccess = () => {
      if (canonical !== path || !this.opened.has(canonical))
        throw new HostError("file-not-open", "Open this file before saving it.", 403);
    };
    assertAccess();
    return this.result(
      canonical,
      await writeBrowse(
        { kind: "worktree", repo: dirname(canonical) },
        basename(canonical),
        expectedIdentity,
        text,
        assertAccess,
      ),
    );
  }
}
