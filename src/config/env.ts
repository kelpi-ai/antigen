import { z } from "zod";

const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  CODEX_BIN: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  CHROME_PATH: z.string().min(1),
  ARTIFACTS_DIR: z.string().min(1).default(".incident-loop-artifacts"),
  MAX_SCENARIOS_PER_PR: z.coerce.number().int().positive().default(5),
  P3_EXECUTOR_CONCURRENCY: z.coerce.number().int().positive().default(2),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  return parsed.data;
}

export const env = new Proxy({} as Env, {
  get(_t, prop) {
    return loadEnv()[prop as keyof Env];
  },
});
