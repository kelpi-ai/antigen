import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serve as inngestServe } from "inngest/hono";
import { pathToFileURL } from "node:url";
import { inngest } from "./inngest/client";
import { functions } from "./inngest";
import { env } from "./config/env";
import { githubWebhookAdapter } from "./webhooks/github";

export function buildApp(): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/webhooks/github", githubWebhookAdapter);
  app.on(
    ["GET", "POST", "PUT"],
    "/api/inngest",
    inngestServe({ client: inngest, functions: [...functions] }),
  );
  return app;
}

const isMainModule = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isMainModule) {
  const app = buildApp();
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Server on http://localhost:${info.port}`);
    console.log(`Inngest: http://localhost:${info.port}/api/inngest`);
  });
}
