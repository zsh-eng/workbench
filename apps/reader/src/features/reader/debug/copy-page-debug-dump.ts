import type { useToast } from "@/hooks/use-toast";
import type { ResolvedSpread } from "@/lib/pagination-v2";
import {
  buildReaderPageDebugDump,
  collectReaderPageDebugDumpEnvironment,
  serializeReaderPageDebugDump,
  type BuildReaderPageDebugDumpOptions,
} from "./page-debug-dump";

interface CopyReaderPageDebugDumpOptions extends Omit<
  BuildReaderPageDebugDumpOptions,
  "spread" | "environment"
> {
  spread: ResolvedSpread | null;
  stageSlotElement: HTMLElement | null;
  stageContentElement: HTMLElement | null;
}

/** Copies the debug dump of the page in view, for Debug mode. */
export async function copyReaderPageDebugDump(
  {
    spread,
    stageSlotElement,
    stageContentElement,
    ...options
  }: CopyReaderPageDebugDumpOptions,
  toast: ReturnType<typeof useToast>["toast"],
): Promise<void> {
  if (!spread) {
    toast({ message: "Page is not ready to copy.", variant: "destructive" });
    return;
  }
  const dump = buildReaderPageDebugDump({
    ...options,
    spread,
    environment: collectReaderPageDebugDumpEnvironment({
      stageSlotElement,
      stageContentElement,
    }),
  });
  try {
    await navigator.clipboard.writeText(serializeReaderPageDebugDump(dump));
    toast({ message: "Copied debug dump." });
  } catch {
    toast({ message: "Could not copy debug dump.", variant: "destructive" });
  }
}
