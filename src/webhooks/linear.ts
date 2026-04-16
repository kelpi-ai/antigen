import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { env } from "../config/env";
import { inngest } from "../inngest/client";

interface LinearWebhookData {
  id?: unknown;
  identifier?: unknown;
  url?: unknown;
  labels?: unknown;
}

interface LinearWebhookPayload {
  type?: unknown;
  action?: unknown;
  data?: unknown;
}

function normalizeLabelName(label: unknown): string | undefined {
  if (typeof label === "string") {
    return label;
  }

  if (typeof label === "object" && label !== null && "name" in label) {
    const candidate = (label as { name?: unknown }).name;
    return typeof candidate === "string" ? candidate : undefined;
  }

  return undefined;
}

function getLabelNames(rawLabels: unknown): string[] {
  if (!Array.isArray(rawLabels)) {
    return [];
  }

  return rawLabels
    .map(normalizeLabelName)
    .filter((value): value is string => Boolean(value))
    .filter(Boolean);
}

function normalizeLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

function extractModule(rawLabels: unknown): string {
  const labels = getLabelNames(rawLabels);
  const moduleLabel = labels.find((label) =>
    normalizeLabelKey(label).startsWith("module:"),
  );
  if (!moduleLabel) {
    return "unknown";
  }

  const moduleValue = normalizeLabelKey(moduleLabel).slice("module:".length).trim();
  return moduleValue.length > 0 ? moduleValue : "unknown";
}

function isBugLabeled(rawLabels: unknown): boolean {
  const labels = getLabelNames(rawLabels);
  return labels.some((label) => normalizeLabelKey(label) === "bug");
}

function normalizeNormalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function verifyLinearSignature(body: string, signature: string): boolean {
  const normalizedSignature = signature.trim();
  if (!normalizedSignature || !env.LINEAR_WEBHOOK_SECRET) {
    return false;
  }

  const secret = env.LINEAR_WEBHOOK_SECRET;
  const expectedSignature = createHmac("sha256", secret).update(body).digest("hex");
  const expected = Buffer.from(expectedSignature, "hex");
  const actual = Buffer.from(
    normalizedSignature.startsWith("sha256=")
      ? normalizedSignature.slice("sha256=".length)
      : normalizedSignature,
    "hex",
  );

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function parseWebhookBody(
  payload: LinearWebhookPayload,
): {
  ticketId: string;
  identifier: string;
  module: string;
  url: string;
  labels: string[];
} | null {
  const data = payload.data as LinearWebhookData;
  const ticketId = normalizeNormalizedString(data?.id);
  const identifier = normalizeNormalizedString(data?.identifier);
  const url = normalizeNormalizedString(data?.url);
  const labels = getLabelNames(data?.labels);

  if (
    typeof payload.type !== "string" ||
    typeof payload.action !== "string" ||
    !ticketId ||
    !identifier ||
    !url
  ) {
    return null;
  }

  return {
    ticketId,
    identifier,
    module: extractModule(labels),
    url,
    labels,
  };
}

export function mountLinearWebhook(app: Hono): void {
  app.post("/webhooks/linear", async (c) => {
    const signature = c.req.header("linear-signature") ?? "";
    const body = await c.req.text();

    if (!verifyLinearSignature(body, signature)) {
      return c.json({ error: "invalid signature" }, 401);
    }

    let rawPayload: LinearWebhookPayload;
    try {
      rawPayload = (await JSON.parse(body)) as LinearWebhookPayload;
    } catch {
      return c.body(null, 204);
    }

    if (rawPayload.type !== "Issue" || rawPayload.action !== "create") {
      return c.body(null, 204);
    }

    const parsed = parseWebhookBody(rawPayload);
    if (!parsed || !isBugLabeled(parsed.labels)) {
      return c.body(null, 204);
    }

    await inngest.send({
      name: "linear/ticket.created",
      data: {
        ticketId: parsed.ticketId,
        identifier: parsed.identifier,
        module: parsed.module,
        url: parsed.url,
      },
    });

    return c.json({}, 202);
  });
}
