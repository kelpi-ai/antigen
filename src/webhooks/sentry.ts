import type { Hono } from "hono";
import { env } from "../config/env";
import { inngest } from "../inngest/client";
import { verifyHmacSha256 } from "./verify";

interface SentryIssuePayload {
  id?: string;
  title?: string;
  web_url?: string;
  permalink?: string;
  culprit?: string;
  environment?: string;
  release?: string;
}

interface SentryWebhookPayload {
  action?: string;
  data?: {
    issue?: SentryIssuePayload;
  };
}

export function mountSentryWebhook(app: Hono): void {
  app.post("/webhooks/sentry", async (c) => {
    const signature = c.req.header("sentry-hook-signature") ?? "";
    const resource = c.req.header("sentry-hook-resource") ?? "";
    const body = await c.req.text();

    if (!verifyHmacSha256({ body, signature, secret: env.SENTRY_WEBHOOK_SECRET })) {
      return c.json({ error: "invalid signature" }, 401);
    }

    if (resource !== "issue") {
      return c.json({ accepted: true }, 202);
    }

    let parsed: SentryWebhookPayload;
    try {
      parsed = JSON.parse(body) as SentryWebhookPayload;
    } catch {
      return c.json({ accepted: false }, 400);
    }

    if (parsed.action !== "created" || !parsed.data?.issue) {
      return c.json({ accepted: true }, 202);
    }

    const issue = parsed.data.issue;
    if (typeof issue.id !== "string" || issue.id.length === 0) {
      return c.json({ accepted: false, error: "invalid issue payload" }, 400);
    }

    const issueUrl = issue.web_url ?? issue.permalink;

    await inngest.send({
      name: "sentry/issue.created",
      data: {
        action: parsed.action,
        issue: {
          id: issue.id,
          title: issue.title,
          web_url: issueUrl,
          permalink: issue.permalink,
          culprit: issue.culprit,
          environment: issue.environment,
          release: issue.release,
        },
      },
    });

    return c.json({ accepted: true }, 202);
  });
}
