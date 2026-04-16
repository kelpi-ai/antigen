import { z } from "zod";

const BaseEnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  ARTIFACTS_DIR: z.string().min(1).default(".incident-loop-artifacts"),
  PORT: z.coerce.number().int().positive().default(3000),
});

const P2EnvSchema = BaseEnvSchema.extend({
  OPENAI_API_KEY: z.string().min(1),
  TARGET_APP_URL: z.string().min(1),
  SENTRY_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  LINEAR_WEBHOOK_SECRET: z.string().min(1),
  TARGET_REPO_PATH: z.string().min(1),
  TARGET_REPO_WORKTREE_ROOT: z.string().min(1),
  TARGET_REPO_REMOTE: z.string().min(1).default("origin"),
  TARGET_REPO_BASE_BRANCH: z.string().min(1).default("main"),
  FFMPEG_BIN: z.string().min(1).optional(),
});

const P3EnvSchema = BaseEnvSchema.extend({
  CODEX_BIN: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  CHROME_PATH: z.string().min(1),
  MAX_SCENARIOS_PER_PR: z.coerce.number().int().positive().default(5),
  P3_EXECUTOR_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

export type Env = z.infer<typeof BaseEnvSchema>;
export type P2Env = z.infer<typeof P2EnvSchema>;
export type P3Env = z.infer<typeof P3EnvSchema>;

function formatEnvError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

function parseEnv<T extends z.ZodTypeAny>(schema: T): z.output<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${formatEnvError(parsed.error)}`);
  }

  return parsed.data;
}

function createEnvProxy<T extends object>(loader: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      return loader()[prop as keyof T];
    },
  });
}

export function loadEnv(): Env {
  return parseEnv(BaseEnvSchema);
}

export function loadP2Env(): P2Env {
  return parseEnv(P2EnvSchema);
}

export function loadP3Env(): P3Env {
  return parseEnv(P3EnvSchema);
}

export const env = createEnvProxy(loadEnv);
export const p2Env = createEnvProxy(loadP2Env);
export const p3Env = createEnvProxy(loadP3Env);
