import { env } from "../config/env";
import { invokeCodex } from "../codex/invoke";
import { extractTaggedJson } from "./parse";
import {
  createHuntRun,
  createScenarioWorkspace,
  updateHuntRunMetadata,
} from "./run";
import { ensureExecutableScenario, runWithConcurrencyLimit, selectTopScenarios, shouldCreateInvestigation } from "./policy";
import { buildHunterExecutorPrompt } from "../prompts/hunterExecutor";
import { buildHunterPlannerPrompt } from "../prompts/hunterPlanner";
import { buildHunterReducerPrompt } from "../prompts/hunterReducer";
import { launchChromeSession } from "./browser/session";
import { writeCodexConfig } from "./codex/config";
import type { ExecutorResult, HuntScenario, ReadyForReviewEvent, ReducerResult } from "./contracts";

interface RunPrHunterInput {
  event: ReadyForReviewEvent;
  step?: { run: (...args: any[]) => Promise<any> };
}

interface PlannerResult {
  previewUrl: string | null;
  scenarios: HuntScenario[];
}

async function runStep<T>(step: RunPrHunterInput["step"], name: string, fn: () => Promise<T>): Promise<T> {
  if (!step) {
    return fn();
  }

  return step.run(name, fn) as Promise<T>;
}

async function runWithScenario(
  runDir: string,
  event: ReadyForReviewEvent,
  previewUrl: string,
  scenario: HuntScenario,
  step?: RunPrHunterInput["step"],
) {
  const workspace = await createScenarioWorkspace({
    runDir,
    scenarioId: scenario.id,
  });

  const session = await launchChromeSession({
    chromePath: env.CHROME_PATH,
    userDataDir: workspace.profileDir,
  });

  try {
    await writeCodexConfig({
      codexDir: workspace.codexDir,
      wsEndpoint: session.wsEndpoint,
    });

    const result = await runStep(
      step,
      `run-executor:${scenario.id}`,
      () =>
        invokeCodex(
          buildHunterExecutorPrompt({
            prNumber: event.prNumber,
            previewUrl,
            scenario,
            screenshotPath: workspace.screenshotPath,
          }),
          { cwd: workspace.scenarioDir },
        ),
    );

    return extractTaggedJson<ExecutorResult>(result.stdout, "P3_EXECUTOR_JSON");
  } finally {
    session.process.kill();
  }
}

async function runReducer(
  runDir: string,
  runMetadataPath: string,
  event: ReadyForReviewEvent,
  previewUrl: string | null,
  plannerScenarios: HuntScenario[],
  selectedScenarios: HuntScenario[],
  executorResults: ExecutorResult[],
  step?: RunPrHunterInput["step"],
) {
  const reducerPrompt = buildHunterReducerPrompt({
    repo: event.repo,
    prNumber: event.prNumber,
    prUrl: event.prUrl,
    previewUrl,
    executorResults,
  });
  const result = await runStep(step, "run-reducer", () =>
    invokeCodex(reducerPrompt, {
      cwd: runDir,
    }),
  );

  const reducerResult = extractTaggedJson<ReducerResult>(
    result.stdout,
    "P3_REDUCER_JSON",
  );

  const credibleFailureCount = executorResults.filter(shouldCreateInvestigation).length;

  const updateMetadata = () =>
    updateHuntRunMetadata(runMetadataPath, {
      status: reducerResult.status,
      previewUrl,
      totalScenarioCount: plannerScenarios.length,
      selectedScenarioCount: selectedScenarios.length,
      executorResultCount: executorResults.length,
      credibleFailureCount,
      selectedScenarioIds: selectedScenarios.map((scenario) => scenario.id),
      eventName: "github/pr.ready_for_review",
    });

  await runStep(step, "update-metadata", updateMetadata);

  return reducerResult;
}

export async function runPrHunter({
  event,
  step,
}: RunPrHunterInput): Promise<ReducerResult> {
  const run = await runStep(step, "create-run", () =>
    createHuntRun({
      artifactsRoot: env.ARTIFACTS_DIR,
      prNumber: event.prNumber,
      repo: event.repo,
    }),
  );

  const plannerOutput = await runStep(step, "run-planner", () =>
    invokeCodex(
      buildHunterPlannerPrompt({
        event,
        maxScenarios: env.MAX_SCENARIOS_PER_PR,
      }),
      { cwd: run.runDir },
    ),
  );
  const plannerResult = extractTaggedJson<PlannerResult>(
    plannerOutput.stdout,
    "P3_PLANNER_JSON",
  );

  const previewUrl = plannerResult.previewUrl;

  if (previewUrl === null) {
    return runReducer(
      run.runDir,
      run.metadataPath,
      event,
      null,
      plannerResult.scenarios,
      [],
      [],
      step,
    );
  }

  const selectedScenarios = selectTopScenarios(
    plannerResult.scenarios,
    env.MAX_SCENARIOS_PER_PR,
  ).map((scenario) => ensureExecutableScenario(scenario));

  const executorResults = await runWithConcurrencyLimit(
    selectedScenarios,
    env.P3_EXECUTOR_CONCURRENCY,
    (scenario) =>
      runWithScenario(run.runDir, event, previewUrl, scenario, step),
  );

  return runReducer(
    run.runDir,
    run.metadataPath,
    event,
    plannerResult.previewUrl,
    plannerResult.scenarios,
    selectedScenarios,
    executorResults,
    step,
  );
}
