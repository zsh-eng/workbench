import { runMigrationScenario } from "@/features/sync-lab/core/migrations";
import { SYNC_V2_DATABASE_VERSION } from "@/lib/sync-v2/db";
import Dexie from "dexie";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fake-indexeddb uses Node structuredClone, which preserves Node Blob bytes.
beforeEach(() => vi.stubGlobal("Blob", NodeBlob));
afterEach(() => vi.unstubAllGlobals());

describe("Sync Lab historical database migrations", () => {
  it.each([3, 5] as const)(
    "upgrades actual version %s storage and deletes the isolated database",
    async (version) => {
      const report = await runMigrationScenario(version);
      expect(report.databaseName).toMatch(/^sync-lab-migration-/);
      expect(report.before.version).toBe(version);
      expect(report.toVersion).toBe(SYNC_V2_DATABASE_VERSION);
      expect(report.passed).toBe(true);
      expect(report.checks).toHaveLength(7);
      expect(report.after.counts.books).toBe(1);
      expect(report.after.counts.files).toBe(1);
      expect(report.after.counts.notes).toBe(1);
      expect(await Dexie.exists(report.databaseName)).toBe(false);
    },
  );
});
