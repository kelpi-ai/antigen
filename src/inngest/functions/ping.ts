import { inngest } from "../client";

export const ping = inngest.createFunction(
  { id: "ping" },
  { event: "test/ping" },
  async ({ event, step }) => {
    await step.run("log", () => {
      console.log("ping received", event.data);
      return { ok: true, receivedAt: new Date().toISOString() };
    });
    return { status: "pong" };
  },
);
