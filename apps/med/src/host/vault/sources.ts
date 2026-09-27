import { createHash } from "node:crypto";
import { chmod, mkdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../runtime/process";
import { database, type Database } from "./database";
export interface SavedSource {
  id: string;
  kind: "repo" | "vault";
  path: string;
  identity: string;
}
export class SourceCatalogue {
  private constructor(
    private db: Database,
    readonly stateDir: string,
  ) {}
  static async open(stateDir: string) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const path = join(stateDir, "sources.sqlite");
    const db = await database(path);
    await chmod(path, 0o600);
    db.exec(
      "CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, identity TEXT NOT NULL)",
    );
    return new SourceCatalogue(db, stateDir);
  }
  close() {
    this.db.close();
  }
  list() {
    return this.db.prepare("SELECT * FROM sources ORDER BY kind,path").all() as SavedSource[];
  }
  async add(kind: SavedSource["kind"], input: string) {
    let path = await realpath(input);
    if (!(await stat(path)).isDirectory()) throw new Error("Choose a directory.");
    let identity = path;
    if (kind === "repo") {
      path = await realpath(
        (await git(path, ["rev-parse", "--show-toplevel"])).toString("utf8").trim(),
      );
      identity = await realpath(
        (await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
          .toString("utf8")
          .trim(),
      );
    }
    const id = `${kind}_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
    const info = await stat(identity);
    const directoryIdentity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
    this.db
      .prepare("INSERT OR REPLACE INTO sources VALUES (?,?,?,?)")
      .run(id, kind, path, directoryIdentity);
    return { id, kind, path, identity: directoryIdentity };
  }
  async require(id: string, kind?: SavedSource["kind"]) {
    const source = this.list().find((source) => source.id === id);
    if (!source || (kind && source.kind !== kind))
      throw new Error("Choose a registered source ID from sources list.");
    const canonical = await realpath(source.path);
    const identityPath =
      source.kind === "repo"
        ? await realpath(
            (await git(canonical, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
              .toString("utf8")
              .trim(),
          )
        : canonical;
    const info = await stat(identityPath);
    if (
      canonical !== source.path ||
      source.identity !== `${info.dev}:${info.ino}:${info.birthtimeMs}`
    )
      throw new Error("The registered directory changed. Remove it and register it again.");
    return source;
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM sources WHERE id=?").run(id);
  }
  indexPath(id: string) {
    return join(this.stateDir, "vaults", `${id}.sqlite`);
  }
}
