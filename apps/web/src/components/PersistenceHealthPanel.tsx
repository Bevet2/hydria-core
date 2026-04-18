import { useState } from "react";
import type { PersistenceHealthReport } from "../lib/api";

type PersistenceHealthPanelProps = {
  health: PersistenceHealthReport | null;
  onRefresh: () => Promise<void>;
};

function renderStatusPill(status: string) {
  return (
    <span className={`pill ${status === "ok" ? "pill--ok" : ""}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function PersistenceHealthPanel({
  health,
  onRefresh
}: PersistenceHealthPanelProps) {
  const [busy, setBusy] = useState(false);

  async function handleRefresh() {
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const projectionEntries = health ? Object.entries(health.projections) : [];
  const derivedEntries = health ? Object.entries(health.derivedArtifacts) : [];

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Persistence Health</h2>
        {renderStatusPill(health?.status ?? "unknown")}
      </div>
      {health ? (
        <>
          <div className="meta-stack">
            <span>Database: {health.database.path}</span>
            <span>
              Arena rounds: {health.database.arenaRoundCount} | Student sessions:{" "}
              {health.database.studentSessionCount}
            </span>
            <span>
              WAL: {health.database.walExists ? "present" : "missing"} | SHM:{" "}
              {health.database.shmExists ? "present" : "missing"}
            </span>
          </div>

          <h4>Projections</h4>
          <div className="health-list">
            {projectionEntries.map(([key, entry]) => (
              <div key={key} className="health-item">
                <div className="health-item__header">
                  <strong>{key}</strong>
                  {renderStatusPill(entry.status)}
                </div>
                <span className="muted">
                  {entry.entryCount ?? "n/a"} entries
                  {entry.matchesDatabaseCount === null
                    ? ""
                    : entry.matchesDatabaseCount
                      ? " | synced"
                      : " | mismatch"}
                </span>
              </div>
            ))}
          </div>

          <h4>Derived artifacts</h4>
          <div className="health-list">
            {derivedEntries.map(([key, entry]) => (
              <div key={key} className="health-item">
                <div className="health-item__header">
                  <strong>{key}</strong>
                  {renderStatusPill(entry.status)}
                </div>
                <span className="muted">
                  {entry.rebuildableFromPersistence ? "rebuildable" : "not rebuildable"}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="muted">Persistence health has not been loaded yet.</p>
      )}

      <div className="actions">
        <button type="button" className="button button--secondary" onClick={handleRefresh}>
          {busy ? "Refreshing..." : "Refresh persistence"}
        </button>
      </div>
    </section>
  );
}
