import { z } from "zod";

const optionalTrimmedString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

let envFilesLoaded = false;

function loadEnvFiles(): void {
  if (envFilesLoaded) {
    return;
  }
  envFilesLoaded = true;

  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return;
  }

  for (const path of [".env", ".env.local"]) {
    try {
      process.loadEnvFile(path);
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
}

const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  TARGET_APP_URL: z.string().url(),
  SENTRY_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  ARTIFACTS_DIR: z.string().min(1).default(".incident-loop-artifacts"),
  CHROME_PATH: optionalTrimmedString,
  CHROME_REMOTE_DEBUGGING_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
  FFMPEG_BIN: optionalTrimmedString,
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  loadEnvFiles();

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
