import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serve as inngestServe } from "inngest/hono";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { inngest } from "./inngest/client";
import { functions } from "./inngest";
import { env } from "./config/env";
import { buildRunDetailViewModel } from "./demo/runDetails";
import { renderRunDetailPage } from "./demo/page";
import { resolveDemoBrowserMp4Path } from "./demo/media";
import { mountSentryWebhook } from "./webhooks/sentry";

export function buildApp(): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/demo", async (c) => {
    try {
      const detail = await buildRunDetailViewModel({ artifactsRoot: env.ARTIFACTS_DIR });
      return c.html(renderRunDetailPage(detail));
    } catch {
      return c.text("No runs found", 404);
    }
  });
  app.get("/demo/data", async (c) => {
    try {
      const detail = await buildRunDetailViewModel({ artifactsRoot: env.ARTIFACTS_DIR });
      return c.json(detail);
    } catch {
      return c.json({ error: "No runs found" }, 404);
    }
  });
  app.get("/demo/media/runs/:runId/browser.mp4", async (c) => {
    const mediaPath = resolveDemoBrowserMp4Path({
      artifactsRoot: env.ARTIFACTS_DIR,
      runId: c.req.param("runId"),
    });
    if (!mediaPath) {
      return c.text("Not found", 404);
    }

    try {
      const fileStat = await stat(mediaPath);
      if (!fileStat.isFile()) {
        return c.text("Not found", 404);
      }

      const file = await readFile(mediaPath);
      return c.body(file, 200, { "Content-Type": "video/mp4" });
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return c.text("Not found", 404);
      }
      return c.text("Server error", 500);
    }
  });
  app.on(
    ["GET", "POST", "PUT"],
    "/api/inngest",
    inngestServe({ client: inngest, functions: [...functions] }),
  );
  mountSentryWebhook(app);
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
