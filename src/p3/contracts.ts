export type ScenarioRisk = "high" | "medium" | "low";
export type ScenarioMode = "read_safe" | "mutating";
export type ExecutorOutcome = "passed" | "failed" | "uncertain";

export interface ReadyForReviewEvent {
  prNumber: number;
  repo: string;
  prUrl: string;
  headSha: string;
  baseSha: string;
  previewUrl?: string;
}

export interface HuntScenario {
  id: string;
  summary: string;
  rationale: string;
  targetArea: string;
  routeHint?: string;
  risk: ScenarioRisk;
  mode: ScenarioMode;
  guardrails: string[];
  expectedEvidence: string[];
}

export interface PlannerResult {
  previewUrl: string | null;
  scenarios: HuntScenario[];
}

export interface ExecutorResult {
  scenarioId: string;
  outcome: ExecutorOutcome;
  summary: string;
  finalUrl?: string;
  consoleSignals: string[];
  networkSignals: string[];
  evidence: string[];
  screenshotPath?: string;
}

export interface InvestigationTicketAction {
  action: "create" | "update";
  identifier?: string;
  title: string;
  body: string;
}

export interface ReducerResult {
  status: "clean" | "failures" | "partial" | "skipped";
  prComment: string;
  investigationTickets: InvestigationTicketAction[];
}
