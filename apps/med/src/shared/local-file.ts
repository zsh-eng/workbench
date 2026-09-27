import { z } from "zod";
import { browseReadSchema, type BrowseRead } from "./browse";

export const localPathSchema = z.string().min(1).max(4096);
export const localReadSchema = browseReadSchema.omit({ source: true }).extend({
  source: z.object({ kind: z.literal("local"), path: localPathSchema }),
  vault: z.object({ id: z.string(), path: z.string() }).optional(),
});
export type LocalRead = z.infer<typeof localReadSchema>;
export type FileRead =
  | BrowseRead
  | LocalRead
  | (Omit<BrowseRead, "source"> & {
      source: { kind: "drop"; id: string };
    });
export type FileWrite = (file: FileRead, text: string) => Promise<FileRead>;
export function isBrowseFile(file: FileRead): file is BrowseRead {
  return file.source.kind === "worktree" || file.source.kind === "commit";
}
