import { z } from "zod";

const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  TARGET_APP_URL: z.string().min(1),
  SENTRY_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  LINEAR_WEBHOOK_SECRET: z.string().min(1),
  TARGET_REPO_PATH: z.string().min(1),
  TARGET_REPO_WORKTREE_ROOT: z.string().min(1),
  TARGET_REPO_REMOTE: z.string().min(1).default("origin"),
  TARGET_REPO_BASE_BRANCH: z.string().min(1).default("main"),
  ARTIFACTS_DIR: z.string().min(1).default(".incident-loop-artifacts"),
  CHROME_PATH: z.string().min(1).optional(),
  FFMPEG_BIN: z.string().min(1).optional(),
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
