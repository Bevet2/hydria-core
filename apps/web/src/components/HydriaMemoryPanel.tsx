import type { HydriaMemoryItem, HydriaMemorySnapshot } from "../lib/api";

type HydriaMemoryPanelProps = {
  memory: HydriaMemorySnapshot | null;
  title?: string;
};

function renderPriorityLabel(value: HydriaMemoryItem["priority"]) {
  return value;
}

function MemoryColumn({
  label,
  items,
  emptyLabel
}: {
  label: string;
  items: HydriaMemoryItem[];
  emptyLabel: string;
}) {
  return (
    <section className="memory-column">
      <h3>{label}</h3>
      {items.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <div className="memory-item-list">
          {items.map((item) => (
            <article key={item.itemId} className="memory-item">
              <div className="memory-item__header">
                <strong>{item.title}</strong>
                <span className="pill">{renderPriorityLabel(item.priority)}</span>
              </div>
              <p>{item.content}</p>
              {item.tags.length > 0 ? (
                <div className="history-badges">
                  {item.tags.map((tag) => (
                    <span key={`${item.itemId}-${tag}`} className="pill">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function HydriaMemoryPanel({ memory, title = "Hydria Memory" }: HydriaMemoryPanelProps) {
  if (!memory) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>{title}</h2>
        </div>
        <p className="muted">No Hydria memory snapshot is available for this run.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{title}</h2>
        <span className="pill">{memory.retrieval.strategyId}</span>
      </div>
      <p>{memory.summary}</p>
      <div className="overview-grid">
        <div className="overview-item">
          <span>Research intent</span>
          <strong>{memory.retrieval.researchIntent ?? "none"}</strong>
        </div>
        <div className="overview-item">
          <span>Temporal type</span>
          <strong>{memory.retrieval.temporalQueryType ?? "none"}</strong>
        </div>
        <div className="overview-item">
          <span>Preferred domains</span>
          <strong>
            {memory.retrieval.preferredDomains.length > 0
              ? memory.retrieval.preferredDomains.join(", ")
              : "none"}
          </strong>
        </div>
        <div className="overview-item">
          <span>Student-rule links</span>
          <strong>{memory.retrieval.studentRuleIds.length}</strong>
        </div>
      </div>
      <div className="memory-grid">
        <MemoryColumn
          label="Core"
          items={memory.core}
          emptyLabel="No core memory items for this run."
        />
        <MemoryColumn
          label="Episodic"
          items={memory.episodic}
          emptyLabel="No episodic notes were captured."
        />
        <MemoryColumn
          label="Semantic"
          items={memory.semantic}
          emptyLabel="No semantic rules were attached."
        />
        <MemoryColumn
          label="Archival"
          items={memory.archival}
          emptyLabel="No archival references were attached."
        />
      </div>
    </section>
  );
}
