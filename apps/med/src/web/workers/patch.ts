import { parsePatchFiles } from "@pierre/diffs";

self.onmessage = (event: MessageEvent<{ id: number; patch: string }>) => {
  const { id, patch } = event.data;
  try {
    const files = parsePatchFiles(patch, { throwOnError: true }).flatMap((parsed) => parsed.files);
    self.postMessage({ id, files });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
