/** Stored legacy settings; the active Reader preferences use localStorage. */
import { db, isNotDeleted } from "./database";

export interface ReadingSettings {
  /**
   * Legacy settings shape kept for IndexedDB/sync schema compatibility.
   * The active reader UI currently uses `ReaderSettings` from
   * `src/types/reader.types.ts` via `useReaderSettings` (localStorage).
   */
  id: string; // Primary key (single record, use 'default')
  fontSize: number; // In pixels (16-24)
  lineHeight: number; // Multiplier (1.2-2.0)
  mode: "scroll" | "paginated";
  theme?: "light" | "dark" | "sepia";
}

export async function getReadingSettings(): Promise<ReadingSettings> {
  const settings = await db.readingSettings.get("default");

  if (settings && isNotDeleted(settings)) {
    return settings;
  }

  const defaultSettings: ReadingSettings = {
    id: "default",
    fontSize: 18,
    lineHeight: 1.6,
    mode: "scroll",
    theme: "light",
  };

  await db.readingSettings.add({ ...defaultSettings, isDeleted: false });
  return (await db.readingSettings.get("default"))!;
}
