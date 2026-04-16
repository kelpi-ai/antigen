import { p3Env } from "../config/env";
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
import type {
  ExecutorResult,
  HuntScenario,
  PlannerResult,
  ReadyForReviewEvent,
  ReducerResult,
} from "./contracts";

type ExecutorOutcome =
  | { status: "ok"; result: ExecutorResult }
  | { status: "error"; error: unknown };

interface RunPrHunterInput {
  event: ReadyForReviewEvent;
  step?: { run: (...args: any[]) => Promise<any> };
}

function codexLoggers(phase: string) {
  return {
    onStdoutChunk(chunk: string) {
      console.log(`[${phase}][stdout] ${chunk}`);
    },
    onStderrChunk(chunk: string) {
      console.error(`[${phase}][stderr] ${chunk}`);
    },
  };
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
) {
  const workspace = await createScenarioWorkspace({
    runDir,
    scenarioId: scenario.id,
  });

  const session = await launchChromeSession({
    chromePath: p3Env.CHROME_PATH,
    userDataDir: workspace.profileDir,
  });

  try {
    await writeCodexConfig({
      codexDir: workspace.codexDir,
      wsEndpoint: session.wsEndpoint,
    });

    const result = await invokeCodex(
      buildHunterExecutorPrompt({
        prNumber: event.prNumber,
        previewUrl,
        scenario,
        screenshotPath: workspace.screenshotPath,
      }),
      {
        cwd: workspace.scenarioDir,
        skipGitRepoCheck: true,
        ...codexLoggers(`executor:${scenario.id}`),
      },
    );

    return extractTaggedJson<ExecutorResult>(result.stdout, "P3_EXECUTOR_JSON");
  } finally {
    try {
      session.process.kill();
    } catch {
      // Preserve original execution failure details.
    }
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
      skipGitRepoCheck: true,
      ...codexLoggers("reducer"),
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
  let runMetadataPath: string | null = null;
  let runPhase = "planner";
  let runPreviewUrl: string | null = null;
  let plannerScenarios: HuntScenario[] = [];
  let plannerResult: PlannerResult | null = null;
  let selectedScenarios: HuntScenario[] = [];
  let executorResults: ExecutorResult[] = [];

  try {
    const run = await runStep(step, "create-run", () =>
      createHuntRun({
        artifactsRoot: p3Env.ARTIFACTS_DIR,
        prNumber: event.prNumber,
        repo: event.repo,
      }),
    );
    runMetadataPath = run.metadataPath;

    runPhase = "planner";
    const plannerOutput = await runStep(step, "run-planner", () =>
      invokeCodex(
        buildHunterPlannerPrompt({
          event,
          maxScenarios: p3Env.MAX_SCENARIOS_PER_PR,
        }),
        {
          cwd: run.runDir,
          skipGitRepoCheck: true,
          ...codexLoggers("planner"),
        },
      ),
    );
    plannerResult = extractTaggedJson<PlannerResult>(
      plannerOutput.stdout,
      "P3_PLANNER_JSON",
    );
    plannerScenarios = plannerResult.scenarios;
    const previewUrl = plannerResult.previewUrl;
    runPreviewUrl = previewUrl;

    if (previewUrl === null) {
      runPhase = "reducer";
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

    runPhase = "executor-selection";
    const topScenarios = selectTopScenarios(
      plannerScenarios,
      p3Env.MAX_SCENARIOS_PER_PR,
    );
    selectedScenarios = [...topScenarios];

    runPhase = "executor-validation";
    const executableScenarios = topScenarios.map((scenario) =>
      ensureExecutableScenario(scenario),
    );
    executorResults = [];
    runPhase = "executor";
    const runExecutor = async (
      scenario: HuntScenario,
    ): Promise<ExecutorOutcome> => {
      try {
        const result = await runStep(
          step,
          `run-executor:${scenario.id}`,
          () =>
            runWithScenario(
              run.runDir,
              event,
              previewUrl,
              scenario,
            ),
        );
        return { status: "ok", result };
      } catch (error) {
        return { status: "error", error };
      }
    };

    const outcomes = await runWithConcurrencyLimit(
      executableScenarios,
      p3Env.P3_EXECUTOR_CONCURRENCY,
      runExecutor,
    );
    const successfulOutcomes = outcomes.filter(
      (outcome) => outcome.status === "ok",
    );
    executorResults = successfulOutcomes.map((outcome) => outcome.result);

    const firstFailure = outcomes.find((outcome) => outcome.status === "error");
    if (firstFailure) {
      throw firstFailure.error;
    }

    runPhase = "reducer";
    return runReducer(
      run.runDir,
      run.metadataPath,
      event,
      previewUrl,
      plannerResult.scenarios,
      executableScenarios,
      executorResults,
      step,
    );
  } catch (error) {
    if (runMetadataPath) {
      await Promise.resolve(
        updateHuntRunMetadata(runMetadataPath, {
          status: "failed",
          previewUrl: runPreviewUrl,
          failurePhase: runPhase,
          failureReason: error instanceof Error ? error.message : String(error),
          totalScenarioCount: plannerScenarios.length,
          selectedScenarioCount: selectedScenarios.length,
          executorResultCount: executorResults.length,
          credibleFailureCount: executorResults.filter(shouldCreateInvestigation).length,
          selectedScenarioIds: selectedScenarios.map((scenario) => scenario.id),
          eventName: "github/pr.ready_for_review",
        }),
      ).catch(() => {});
    }

    throw error;
  }
}
