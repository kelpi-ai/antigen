import type { Context } from "hono";

import { env } from "../config/env";
import { inngest } from "../inngest/client";
import { verifyHmacSha256 } from "./verify";

interface GithubPullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    html_url: string;
    head: {
      sha: string;
    };
    base: {
      sha: string;
    };
  };
  repository: {
    full_name: string;
  };
}

function isReadyForReviewPayload(
  payload: unknown,
): payload is GithubPullRequestPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as Record<string, unknown>;
  return (
    value.action === "ready_for_review" &&
    typeof value.number === "number" &&
    typeof value.pull_request === "object" &&
    value.pull_request !== null &&
    typeof (value.pull_request as Record<string, unknown>).html_url === "string" &&
    typeof (value.pull_request as Record<string, unknown>).head === "object" &&
    (value.pull_request as Record<string, unknown>).head !== null &&
    typeof ((
      value.pull_request as Record<string, unknown>
    ).head as Record<string, unknown>).sha === "string" &&
    typeof (value.pull_request as Record<string, unknown>).base === "object" &&
    (value.pull_request as Record<string, unknown>).base !== null &&
    typeof ((
      value.pull_request as Record<string, unknown>
    ).base as Record<string, unknown>).sha === "string" &&
    typeof value.repository === "object" &&
    value.repository !== null &&
    typeof (value.repository as Record<string, unknown>).full_name === "string"
  );
}

export async function githubWebhookAdapter(c: Context): Promise<Response> {
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? "";
  const eventType = c.req.header("x-github-event");

  if (!verifyHmacSha256({ body, secret: env.GITHUB_WEBHOOK_SECRET, signature })) {
    return c.text("invalid signature", { status: 401 });
  }

  if (eventType !== "pull_request") {
    return c.body(null, { status: 204 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.body(null, { status: 400 });
  }

  if (!isReadyForReviewPayload(payload)) {
    return c.body(null, { status: 204 });
  }

  try {
    await inngest.send({
      name: "github/pr.ready_for_review",
      data: {
        prNumber: payload.number,
        repo: payload.repository.full_name,
        prUrl: payload.pull_request.html_url,
        headSha: payload.pull_request.head.sha,
        baseSha: payload.pull_request.base.sha,
      },
    });
  } catch (error) {
    console.error("failed to dispatch github webhook event", error);
    return c.text("failed to dispatch event", { status: 502 });
  }

  return c.body(null, { status: 202 });
}
