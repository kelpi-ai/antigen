import { z } from "zod";

const optionalTrimmedString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const EnvSchema = z.object({
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  TARGET_APP_URL: z.string().url(),
  SENTRY_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_API_KEY: z.string().min(1),
  ARTIFACTS_DIR: z.string().min(1).default(".incident-loop-artifacts"),
  CHROME_PATH: optionalTrimmedString,
  FFMPEG_BIN: optionalTrimmedString,
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
