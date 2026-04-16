import { Codex } from "@openai/codex-sdk";

export interface FixerResult {
  status: "ok";
  prUrl: string;
  testPath: string;
  redEvidence: string;
  greenEvidence: string;
  regressionGuardEvidence: string;
  browserVerificationEvidence?: string;
}

export async function runCodexTask(prompt: string, cwd?: string): Promise<string> {
  const codex = new Codex();
  const thread = codex.startThread(cwd ? { workingDirectory: cwd } : undefined);
  const turn = await thread.run(prompt);
  return turn.finalResponse;
}

const RESULT_PREFIX = "FIXER_RESULT ";
const REQUIRED_FIELDS: (keyof FixerResult)[] = ["status", "prUrl", "testPath", "redEvidence", "greenEvidence", "regressionGuardEvidence"];

function isPresentString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseFixerResult(stdout: string): FixerResult {
  const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX));
  if (!resultLine) {
    throw new Error("missing FIXER_RESULT line");
  }

  const payload = resultLine.slice(RESULT_PREFIX.length);
  const parsed = JSON.parse(payload) as Partial<FixerResult>;

  const missing = REQUIRED_FIELDS.filter((field) => {
    if (field === "status") {
      return parsed.status !== "ok";
    }
    return !isPresentString(parsed[field]);
  });

  if (missing.length > 0) {
    throw new Error(`missing required proof field(s): ${missing.join(", ")}`);
  }

  return {
    status: "ok",
    prUrl: parsed.prUrl!,
    testPath: parsed.testPath!,
    redEvidence: parsed.redEvidence!,
    greenEvidence: parsed.greenEvidence!,
    regressionGuardEvidence: parsed.regressionGuardEvidence!,
    browserVerificationEvidence: parsed.browserVerificationEvidence,
  };
};

export async function runFixer(input: { prompt: string; cwd: string }): Promise<FixerResult> {
  const output = await runCodexTask(input.prompt, input.cwd);
  return parseFixerResult(output);
};
