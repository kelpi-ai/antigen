import { Codex } from "@openai/codex-sdk";
import { z } from "zod";

const ReproducerResultSchema = z.object({
  status: z.string(),
  reproduced: z.boolean(),
  ticketUrl: z.string().url(),
  summary: z.string(),
  finalUrl: z.string().url(),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  evidence: z.object({
    videoPath: z.string(),
    consoleErrors: z.number().int().nonnegative(),
    failedRequests: z.number().int().nonnegative(),
  }),
});

const reproducerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "reproduced",
    "ticketUrl",
    "summary",
    "finalUrl",
    "steps",
    "expected",
    "actual",
    "evidence",
  ],
  properties: {
    status: { type: "string" },
    reproduced: { type: "boolean" },
    ticketUrl: { type: "string", format: "uri" },
    summary: { type: "string" },
    finalUrl: { type: "string", format: "uri" },
    steps: {
      type: "array",
      items: { type: "string" },
    },
    expected: { type: "string" },
    actual: { type: "string" },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["videoPath", "consoleErrors", "failedRequests"],
      properties: {
        videoPath: { type: "string" },
        consoleErrors: { type: "integer", minimum: 0 },
        failedRequests: { type: "integer", minimum: 0 },
      },
    },
  },
} as const;

export type ReproducerResult = z.infer<typeof ReproducerResultSchema>;

export async function runCodexReproducer(input: {
  prompt: string;
  workingDirectory: string;
}): Promise<ReproducerResult> {
  const codex = new Codex();
  const thread = codex.startThread({
    model: "gpt-5.4",
    workingDirectory: input.workingDirectory,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
  });

  const turn = await thread.run(input.prompt, { outputSchema: reproducerOutputSchema });
  let parsed: unknown;
  try {
    parsed = JSON.parse(turn.finalResponse);
  } catch (error) {
    throw new Error(
      `Codex returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return ReproducerResultSchema.parse(parsed);
}
