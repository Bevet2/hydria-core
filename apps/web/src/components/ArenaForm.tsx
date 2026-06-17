import type { ArenaModels } from "../lib/api";
import { suggestedModels } from "../lib/api";

type FallbackInfo = {
  refineFallbackEnabled: boolean;
  localStudentFallbackEnabled: boolean;
};

type ArenaFormProps = {
  question: string;
  models: ArenaModels;
  loading: boolean;
  fallbackInfo?: FallbackInfo | null;
  onQuestionChange: (value: string) => void;
  onModelChange: (key: keyof ArenaModels, value: string) => void;
  onSubmit: () => Promise<void>;
};

const fieldLabels: Record<keyof ArenaModels, string> = {
  respondentA: "Respondent A",
  respondentB: "Respondent B",
  redTeam: "Red Team",
  judge: "Judge",
  synthesizer: "Synthesizer"
};

export function ArenaForm({
  question,
  models,
  loading,
  fallbackInfo,
  onQuestionChange,
  onModelChange,
  onSubmit
}: ArenaFormProps) {
  return (
    <section className="panel panel--form">
      <div className="panel__header">
        <h1>Hydria Core Playground</h1>
        <span className="pill">Debug + Compare + Trace + History</span>
      </div>
      <p className="hero-copy">
        Run a full Hydria Core round, inspect each pipeline step, compare initial vs refined
        answers, review fallbacks, and reload previous runs from local history.
      </p>

      <label className="field">
        <span>Question</span>
        <textarea
          className="text-input text-input--area"
          placeholder="Ask the arena a question..."
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
        />
      </label>

      <div className="form-grid">
        {(Object.keys(models) as Array<keyof ArenaModels>).map((key) => (
          <label key={key} className="field">
            <span>{fieldLabels[key]}</span>
            <input
              list="hydria-model-options"
              className="text-input"
              value={models[key]}
              onChange={(event) => onModelChange(key, event.target.value)}
            />
          </label>
        ))}
      </div>

      <datalist id="hydria-model-options">
        {suggestedModels.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>

      <div className="actions">
        <button type="button" className="button" disabled={loading} onClick={onSubmit}>
          {loading ? "Running arena..." : "Run Arena"}
        </button>
      </div>

      {fallbackInfo ? (
        <div className="info-strip">
          <span>Refine fallback: {fallbackInfo.refineFallbackEnabled ? "enabled" : "disabled"}</span>
          <span>Local student fallback: {fallbackInfo.localStudentFallbackEnabled ? "enabled" : "disabled"}</span>
        </div>
      ) : null}
    </section>
  );
}
