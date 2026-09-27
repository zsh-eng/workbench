import { useEffect, useState } from "react";
import type { BrowseSource } from "../../shared/browse";
import type { FileRead } from "../../shared/local-file";
import { browseSourceKey, type BrowseApi } from "./browse";

export interface FilePreviewReader {
  scope: string;
  read(path: string, signal: AbortSignal): Promise<FileRead>;
}

/** Retain one response only. A new selection removes old bytes immediately. */
export function usePickerPreview(
  api: BrowseApi | undefined,
  source: BrowseSource | null | undefined,
  path: string | undefined,
  revision: number | string,
  reader?: FilePreviewReader,
) {
  const scope = reader?.scope ?? (source ? browseSourceKey(source) : "");
  const key = JSON.stringify([scope, path, revision]);
  const [state, setState] = useState<{
    key: string;
    file: FileRead | null;
    error: string | null;
  }>({
    key: "",
    file: null,
    error: null,
  });
  useEffect(() => {
    if ((!api && !reader) || !scope || !path) return;
    const controller = new AbortController();
    const read = () => {
      if (reader) return reader.read(path, controller.signal);
      const [kind, repo, oid] = JSON.parse(scope) as ["worktree" | "commit", string, string?];
      const requestSource: BrowseSource =
        kind === "commit" ? { kind, repo, oid: oid! } : { kind, repo };
      return api!.read(requestSource, path, controller.signal);
    };
    const load = read();
    void load
      .then((file) => {
        if (
          !controller.signal.aborted &&
          (reader ||
            ("repo" in file.source && browseSourceKey(file.source) === scope && file.path === path))
        )
          setState({ key, file, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            file: null,
            error: error instanceof Error ? error.message : "Cannot preview file.",
          });
      });
    return () => controller.abort();
  }, [api, scope, path, revision, key, reader]);
  const current = state.key === key;
  return {
    file: current ? state.file : null,
    error: current ? state.error : null,
    loading: (!!api || !!reader) && !!scope && !!path && !current,
  };
}
