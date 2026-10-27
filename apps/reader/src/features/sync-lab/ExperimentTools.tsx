import { cleanupAbandonedLabDatabases } from "./core/session-storage";
import { useState, type RefObject } from "react";
import { Check, Download, Upload, X } from "lucide-react";
import type {
  SyncLabController,
  LabSnapshot,
  LabView,
} from "./core/controller";
import { runMigrationScenario, type MigrationReport } from "./core/migrations";
import {
  deserializeLabSnapshot,
  serializeLabSnapshot,
} from "./core/snapshot-file";

/** Snapshot files and migration reports belong to the experiment, not its app clients. */
export function ExperimentTools({
  controller,
  view,
  locked,
  recording,
  ready,
  run,
  upload,
}: {
  controller: SyncLabController;
  view: LabView;
  locked: boolean;
  recording: boolean;
  ready: boolean;
  run: (action: () => Promise<unknown>) => void;
  upload: RefObject<HTMLInputElement | null>;
}) {
  const [snapshots, setSnapshots] = useState<LabSnapshot[]>([]);
  const [cleanupResult, setCleanupResult] = useState("");
  const [migration, setMigration] = useState<MigrationReport>();
  const save = async () => {
    const snapshot = await controller.checkpoint(
      `Checkpoint ${snapshots.length + 1}`,
    );
    setSnapshots((previous) => [...previous, snapshot]);
  };
  const download = async (snapshot: LabSnapshot) => {
    const url = URL.createObjectURL(
      new Blob([await serializeLabSnapshot(snapshot)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sync-lab-${snapshot.name.replaceAll(" ", "-").toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="lab-experiment-tools">
        <div className="lab-panel">
          <header className="lab-panel-heading">
            <h2>Checkpoints</h2>
          </header>
          <div className="lab-tool-content">
            {view.clients.some((client) => client.autoSync) && (
              <p className="lab-hint">Pause automatic sync before saving.</p>
            )}
            <div className="lab-row">
              <button
                className="lab-button"
                disabled={locked || recording || !ready}
                onClick={() => run(save)}
              >
                Save checkpoint
              </button>
              <button
                className="lab-button"
                disabled={locked || recording}
                onClick={() => upload.current?.click()}
              >
                <Upload size={14} /> Import
              </button>
            </div>
            {snapshots.map((snapshot, index) => (
              <div
                className="lab-snapshot"
                key={`${snapshot.capturedAt}-${index}`}
              >
                <span>
                  {snapshot.name}
                  <small>
                    {snapshot.clients.length} clients ·{" "}
                    {new Date(snapshot.capturedAt).toLocaleTimeString()}
                  </small>
                </span>
                <button
                  className="lab-button"
                  disabled={locked || recording}
                  onClick={() => run(() => controller.restore(snapshot))}
                >
                  Restore
                </button>
                <button
                  className="lab-icon"
                  aria-label={`Export ${snapshot.name}`}
                  onClick={() => run(() => download(snapshot))}
                >
                  <Download size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="lab-panel">
          <header className="lab-panel-heading">
            <h2>Migrations</h2>
          </header>
          <div className="lab-tool-content">
            <div className="lab-row">
              <button
                className="lab-button"
                disabled={locked}
                onClick={() =>
                  run(async () => setMigration(await runMigrationScenario(3)))
                }
              >
                Upgrade v3 → current
              </button>
              <button
                className="lab-button"
                disabled={locked}
                onClick={() =>
                  run(async () => setMigration(await runMigrationScenario(5)))
                }
              >
                Upgrade v5 → current
              </button>
              <button
                className="lab-button"
                disabled={locked}
                onClick={() =>
                  run(async () => setMigration(await runMigrationScenario(7)))
                }
              >
                Upgrade v7 → current
              </button>
            </div>
            {migration && (
              <div className="lab-migration" role="status">
                <strong>
                  {migration.passed
                    ? "All migration checks passed"
                    : "Migration check failed"}
                </strong>
                {migration.checks.map((check) => (
                  <span key={check.label}>
                    {check.passed ? <Check size={13} /> : <X size={13} />}
                    {check.label}: {check.passed ? "passed" : "failed"}
                  </span>
                ))}
                <details>
                  <summary>Inspect before / after</summary>
                  <pre>{JSON.stringify(migration, null, 2)}</pre>
                </details>
              </div>
            )}
          </div>
        </div>
        <div className="lab-panel">
          <header className="lab-panel-heading">
            <h2>Clock</h2>
          </header>
          <div className="lab-tool-content">
            <div className="lab-clock">
              <span>Sync offset +{view.elapsedMs / 1000}s</span>
              <button
                className="lab-button"
                disabled={locked}
                aria-label="Advance 1 minute"
                title="Advance sync timestamps by 60 seconds"
                onClick={() => controller.advanceClock(60000)}
              >
                +60s
              </button>
            </div>
          </div>
        </div>
      </div>
      <section className="lab-panel">
        <header className="lab-panel-heading">
          <h2>Storage</h2>
        </header>
        <div className="lab-tool-content">
          {cleanupResult && <p role="status">{cleanupResult}</p>}
          <button
            className="lab-button"
            disabled={locked || recording}
            title="Remove databases from closed experiments; keep active sessions"
            onClick={() =>
              run(async () => {
                const result = await cleanupAbandonedLabDatabases(
                  controller.sessionId,
                );
                setCleanupResult(
                  result.supported
                    ? `Removed ${result.deletedDatabases} abandoned databases. ${result.activeSessions} active sessions kept.${result.failures.length ? ` ${result.failures.length} databases could not be removed.` : ""}`
                    : "This browser cannot check active sessions safely. No databases were removed.",
                );
              })
            }
          >
            Clean abandoned experiments
          </button>
        </div>
      </section>
      <input
        ref={upload}
        disabled={recording}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file)
            run(async () => {
              const snapshot = await deserializeLabSnapshot(await file.text());
              await controller.restore(snapshot);
              setSnapshots((previous) => [...previous, snapshot]);
            });
        }}
      />
    </>
  );
}
