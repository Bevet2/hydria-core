import type {
  StudentAnswerPreview,
  StudentProgressSummary,
  StudentSession
} from "../lib/api";

type StudentLabMainPanelsProps = {
  preview: StudentAnswerPreview | null;
  summary: StudentProgressSummary | null;
  currentSession: StudentSession | null;
  displayedDraft: StudentSession["student"]["draft"] | null;
  displayedResearch: StudentSession["research"] | null;
  displayedToolApplied: boolean;
};

function StudentBulletList({
  items,
  emptyLabel
}: {
  items: string[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="muted">{emptyLabel}</p>;
  }

  return (
    <ul className="bullet-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function answersDiffer(left: string, right: string) {
  return left.trim() !== right.trim();
}

function formatTrend(value: "up" | "flat" | "down") {
  return value;
}

function formatFailureType(value: string) {
  return value.replaceAll("_", " ");
}

function StudentProgressPanel({
  summary,
  currentSession
}: Pick<StudentLabMainPanelsProps, "summary" | "currentSession">) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Student Progress</h2>
        {currentSession ? (
          <span className="pill">
            Session score {currentSession.progression.sessionScore} |{" "}
            {formatTrend(currentSession.progression.trend)}
          </span>
        ) : null}
      </div>
      <div className="summary-grid">
        <div className="summary-card summary-card--strong">
          <span>Global average</span>
          <strong>{summary?.averageSessionScore ?? 0}</strong>
        </div>
        <div className="summary-card">
          <span>Latest session</span>
          <strong>{summary?.latestSessionScore ?? 0}</strong>
        </div>
        <div className="summary-card">
          <span>Average delta</span>
          <strong>{summary?.averageDeltaOverall ?? 0}</strong>
        </div>
        <div className="summary-card">
          <span>Improved rate</span>
          <strong>{Math.round(summary?.improvedRate ?? 0)}%</strong>
        </div>
        <div className="summary-card">
          <span>Worth it rate</span>
          <strong>{Math.round(summary?.worthItRate ?? 0)}%</strong>
        </div>
        <div className="summary-card">
          <span>Recent trend</span>
          <strong>{formatTrend(summary?.recentTrend ?? "flat")}</strong>
        </div>
        {currentSession ? (
          <>
            <div className="summary-card">
              <span>Draft overall</span>
              <strong>{currentSession.progression.draftOverall}</strong>
            </div>
            <div className="summary-card">
              <span>Improved overall</span>
              <strong>{currentSession.progression.improvedOverall}</strong>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function StudentTruthPanel({
  currentSession,
  displayedResearch,
  displayedToolApplied
}: Pick<StudentLabMainPanelsProps, "currentSession" | "displayedResearch" | "displayedToolApplied">) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Truth Engine</h2>
        {displayedResearch ? (
          <span className="pill">
            {displayedToolApplied
              ? currentSession?.tooling.toolImpact ?? displayedResearch.route
              : displayedResearch.route}
          </span>
        ) : null}
      </div>
      {displayedResearch ? (
        <>
          <div className="summary-grid">
            <div className="summary-card">
              <span>Tool used</span>
              <strong>{displayedToolApplied ? "yes" : "no"}</strong>
            </div>
            <div className="summary-card">
              <span>Truth confidence</span>
              <strong>
                {Math.round(
                  (currentSession?.tooling.confidenceScore ??
                    displayedResearch.truth.confidence_score) * 100
                )}
                %
              </strong>
            </div>
            <div className="summary-card">
              <span>No reliable source</span>
              <strong>
                {currentSession?.tooling.noReliableSource ??
                displayedResearch.truth.no_reliable_source
                  ? "yes"
                  : "no"}
              </strong>
            </div>
            <div className="summary-card">
              <span>Research mode</span>
              <strong>{displayedResearch.decision.mode}</strong>
            </div>
            <div className="summary-card">
              <span>Freshness</span>
              <strong>{displayedResearch.verification.freshnessSatisfied ? "ok" : "stale"}</strong>
            </div>
          </div>
          {currentSession ? (
            <p>{currentSession.tooling.toolReason}</p>
          ) : (
            <p>{displayedResearch.decision.reasoning}</p>
          )}
          <h4>Verified facts</h4>
          <StudentBulletList
            items={displayedResearch.truth.verified_facts}
            emptyLabel="No verified facts were injected."
          />
          <h4>Uncertain claims</h4>
          <StudentBulletList
            items={displayedResearch.truth.uncertain_claims}
            emptyLabel="No explicit uncertainty markers."
          />
          <h4>Conflicting information</h4>
          <StudentBulletList
            items={displayedResearch.truth.conflicting_info}
            emptyLabel="No conflicts detected across reliable sources."
          />
        </>
      ) : (
        <p className="muted">
          Run a Student Lab analysis to inspect when the truth engine was used and what it injected
          into the student answer.
        </p>
      )}
    </section>
  );
}

function StudentImpactPanels({ currentSession }: Pick<StudentLabMainPanelsProps, "currentSession">) {
  return (
    <>
      <section className="panel">
        <div className="panel__header">
          <h2>Rule Impact Tracker</h2>
          {currentSession?.ruleImpact.compared ? (
            <span className="pill">
              Delta {currentSession.ruleImpact.metrics.judgeOverallDelta}
            </span>
          ) : null}
        </div>
        {currentSession?.ruleImpact.compared ? (
          <>
            <div className="summary-grid">
              <div className="summary-card">
                <span>Judge delta</span>
                <strong>{currentSession.ruleImpact.metrics.judgeOverallDelta}</strong>
              </div>
              <div className="summary-card">
                <span>Gain global</span>
                <strong>{currentSession.ruleImpact.metrics.gainGlobal}</strong>
              </div>
              <div className="summary-card">
                <span>Length delta</span>
                <strong>{currentSession.ruleImpact.metrics.lengthDeltaWords}</strong>
              </div>
              <div className="summary-card">
                <span>Structure delta</span>
                <strong>{currentSession.ruleImpact.metrics.structureDelta}</strong>
              </div>
              <div className="summary-card">
                <span>Success</span>
                <strong>{currentSession.ruleImpact.metrics.success ? "yes" : "no"}</strong>
              </div>
            </div>
            {currentSession.ruleImpact.judge ? <p>{currentSession.ruleImpact.judge.reasoning}</p> : null}
            {currentSession.ruleImpact.perRule.length > 0 ? (
              <div className="history-list">
                {currentSession.ruleImpact.perRule.map((rule) => (
                  <div key={rule.ruleId} className="history-item">
                    <div className="history-meta">
                      <span>{rule.failureType.replaceAll("_", " ")}</span>
                      <span>{Math.round(rule.activationConfidence * 100)}% activation confidence</span>
                      <span>{rule.evidenceCount} signal(s)</span>
                    </div>
                    <strong>Rule</strong>
                    <span>{rule.rule}</span>
                    <strong>Apply when</strong>
                    <span>{rule.conditions.join(" | ") || "No conditions stored."}</span>
                    <strong>Observed impact</strong>
                    <span>
                      Judge {rule.metrics.judgeOverallDelta}, gain {rule.metrics.gainGlobal},
                      length {rule.metrics.lengthDeltaWords}, structure {rule.metrics.structureDelta}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">
            Rule impact is tracked when the student answer is compared against a baseline draft
            without student-memory rules.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Strategy Impact Tracker</h2>
          {currentSession?.strategyImpact.compared ? (
            <span className="pill">
              {currentSession.strategyImpact.strategyId} | {currentSession.strategyImpact.impactStatus}
            </span>
          ) : null}
        </div>
        {currentSession?.strategyImpact.compared ? (
          <>
            <div className="summary-grid">
              <div className="summary-card">
                <span>Judge delta</span>
                <strong>{currentSession.strategyImpact.metrics.judgeOverallDelta}</strong>
              </div>
              <div className="summary-card">
                <span>Gain global</span>
                <strong>{currentSession.strategyImpact.metrics.gainGlobal}</strong>
              </div>
              <div className="summary-card">
                <span>Length delta</span>
                <strong>{currentSession.strategyImpact.metrics.lengthDeltaWords}</strong>
              </div>
              <div className="summary-card">
                <span>Structure delta</span>
                <strong>{currentSession.strategyImpact.metrics.structureDelta}</strong>
              </div>
              <div className="summary-card">
                <span>Activation</span>
                <strong>
                  {currentSession.strategyImpact.impactStatus} /{" "}
                  {currentSession.strategyImpact.activationMode}
                </strong>
              </div>
              <div className="summary-card">
                <span>Confidence</span>
                <strong>{Math.round(currentSession.strategyImpact.impactConfidence * 100)}%</strong>
              </div>
            </div>
            {currentSession.strategyImpact.judge ? (
              <p>{currentSession.strategyImpact.judge.reasoning}</p>
            ) : null}
          </>
        ) : (
          <p className="muted">
            Strategy impact is tracked when the student answer is compared against a baseline draft
            and recorded by the Student Lab.
          </p>
        )}
      </section>
    </>
  );
}

function StudentSessionReviewPanels({
  preview,
  currentSession,
  displayedDraft
}: Pick<StudentLabMainPanelsProps, "preview" | "currentSession" | "displayedDraft">) {
  const finalStudentAnswer =
    currentSession &&
    answersDiffer(currentSession.student.draft.answer, currentSession.student.final.answer)
      ? currentSession.student.final
      : null;

  return (
    <>
      <section className="panel panel--hero">
        <div className="panel__header">
          <h2>Student Answer</h2>
          {displayedDraft ? (
            <span className="pill">
              Confidence {displayedDraft.confidence}
              {preview
                ? ` | ${preview.durationMs} ms | ${
                    preview.student.toolApplied ? "tool connected" : "no tool"
                  }`
                : ""}
            </span>
          ) : null}
        </div>
        {displayedDraft ? (
          <>
            <div className="response-box">
              <p>{displayedDraft.answer}</p>
            </div>
            <h4>Key points</h4>
            <StudentBulletList
              items={displayedDraft.key_points}
              emptyLabel="No key points captured."
            />
            <h4>Assumptions</h4>
            <StudentBulletList
              items={displayedDraft.assumptions}
              emptyLabel="No assumptions captured."
            />
          </>
        ) : (
          <p className="muted">Generate a student answer to inspect the raw local output.</p>
        )}
      </section>

      {finalStudentAnswer ? (
        <section className="panel">
          <div className="panel__header">
            <h2>Student Final Answer</h2>
            <span className="pill">
              Tool {currentSession?.student.toolApplied ? "applied" : "not applied"}
            </span>
          </div>
          <p>{finalStudentAnswer.answer}</p>
          <h4>Key points</h4>
          <StudentBulletList
            items={finalStudentAnswer.key_points}
            emptyLabel="No grounded key points captured."
          />
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <h2>Teacher Improvement</h2>
          {currentSession ? <span className="pill">{currentSession.judge.verdict}</span> : null}
        </div>
        {currentSession ? (
          <>
            <p>{currentSession.teacher.improved_answer}</p>
            <h4>Fixes applied</h4>
            <StudentBulletList
              items={currentSession.teacher.fixes_applied}
              emptyLabel="Teacher did not record explicit fixes."
            />
            <h4>Remaining uncertainties</h4>
            <StudentBulletList
              items={currentSession.teacher.remaining_uncertainties}
              emptyLabel="No remaining uncertainties reported."
            />
          </>
        ) : (
          <p className="muted">Run the teacher analysis to generate a corrected answer.</p>
        )}
      </section>

      <section className="compare-grid">
        <section className="panel compare-column">
          <div className="panel__header">
            <h2>Red Team</h2>
          </div>
          {currentSession ? (
            <>
              <h4>Attacks</h4>
              <StudentBulletList
                items={currentSession.redTeam.attacks_on_a}
                emptyLabel="No direct attacks recorded."
              />
              <h4>Shared risks</h4>
              <StudentBulletList
                items={currentSession.redTeam.shared_risks}
                emptyLabel="No shared risks recorded."
              />
              <h4>Potentially false claims</h4>
              <StudentBulletList
                items={currentSession.redTeam.potentially_false_claims}
                emptyLabel="No factual claims flagged."
              />
            </>
          ) : (
            <p className="muted">Run analysis to inspect the Red Team critique.</p>
          )}
        </section>

        <section className="panel compare-column compare-column--refined">
          <div className="panel__header">
            <h2>Judge</h2>
          </div>
          {currentSession ? (
            <>
              <div className="summary-grid">
                <div className="summary-card">
                  <span>Verdict</span>
                  <strong>{currentSession.judge.verdict}</strong>
                </div>
                <div className="summary-card">
                  <span>Worth it</span>
                  <strong>{currentSession.judge.worthIt}</strong>
                </div>
                <div className="summary-card">
                  <span>Initial overall</span>
                  <strong>{currentSession.judge.initial_score.overall}</strong>
                </div>
                <div className="summary-card">
                  <span>Improved overall</span>
                  <strong>{currentSession.judge.improved_score.overall}</strong>
                </div>
              </div>
              <p>{currentSession.judge.reasoning}</p>
              <h4>Strong points</h4>
              <StudentBulletList
                items={currentSession.judge.strong_points}
                emptyLabel="No strong points recorded."
              />
            </>
          ) : (
            <p className="muted">Run analysis to inspect the Judge decision.</p>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Weak Points, Lessons, and Coaching</h2>
        </div>
        {currentSession ? (
          <>
            <div className="compare-grid">
              <div className="compare-column">
                <h4>Weak points</h4>
                <StudentBulletList
                  items={currentSession.weakPoints}
                  emptyLabel="No weak points recorded."
                />
              </div>
              <div className="compare-column compare-column--refined">
                <h4>Coaching notes</h4>
                <StudentBulletList
                  items={currentSession.coachingNotes}
                  emptyLabel="No coaching notes recorded."
                />
              </div>
            </div>
            <h4>Lessons learned</h4>
            {currentSession.lessonsLearned.length === 0 ? (
              <p className="muted">No lessons learned extracted.</p>
            ) : (
              <div className="history-list">
                {currentSession.lessonsLearned.map((lesson, index) => (
                  <div key={`${lesson.lessonId}-${index}`} className="history-item">
                    <div className="history-meta">
                      <span>{formatFailureType(lesson.failureType)}</span>
                      <span>{Math.round(lesson.confidence * 100)}% confidence</span>
                      <span>{lesson.evidenceCount} signal(s)</span>
                    </div>
                    <strong>Error</strong>
                    <span>{lesson.error}</span>
                    <strong>Correction</strong>
                    <span>{lesson.correction}</span>
                    <strong>Rule to retain</strong>
                    <span>{lesson.rule}</span>
                    {lesson.conditions.length > 0 ? (
                      <>
                        <strong>Apply when</strong>
                        <span>{lesson.conditions.join(" | ")}</span>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">
            Each analyzed session extracts weak points, corrections, and reusable rules for future
            student learning.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Compressed Training Cycle</h2>
        </div>
        {currentSession ? (
          <div className="compare-grid">
            <div className="compare-column">
              <h4>Input</h4>
              <p>{currentSession.compressedCycle.input}</p>
              <h4>Weak answer</h4>
              <p>{currentSession.compressedCycle.weakAnswer}</p>
            </div>
            <div className="compare-column compare-column--refined">
              <h4>Corrected answer</h4>
              <p>{currentSession.compressedCycle.correctedAnswer}</p>
              <h4>Key correction</h4>
              <p>{currentSession.compressedCycle.keyCorrection}</p>
            </div>
          </div>
        ) : (
          <p className="muted">
            Each analyzed session also creates a compact &quot;bad answer -&gt; corrected answer&quot;
            training example for Qwen.
          </p>
        )}
      </section>
    </>
  );
}

export function StudentLabMainPanels(props: StudentLabMainPanelsProps) {
  return (
    <>
      <StudentProgressPanel summary={props.summary} currentSession={props.currentSession} />
      <StudentTruthPanel
        currentSession={props.currentSession}
        displayedResearch={props.displayedResearch}
        displayedToolApplied={props.displayedToolApplied}
      />
      <StudentImpactPanels currentSession={props.currentSession} />
      <StudentSessionReviewPanels
        preview={props.preview}
        currentSession={props.currentSession}
        displayedDraft={props.displayedDraft}
      />
    </>
  );
}
