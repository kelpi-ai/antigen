import { describe, expect, it } from "vitest";
import { parseCodexEvents, parseCodexMilestones } from "../../src/demo/codexEvents";

describe("parseCodexMilestones", () => {
  it("keeps breadcrumb lookups separate from issue lookups", () => {
    const milestones = parseCodexMilestones([
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "sentry-bubble-reel",
          tool: "get_sentry_resource",
          arguments: { resourceType: "breadcrumbs" },
        },
      },
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "sentry-bubble-reel",
          tool: "get_sentry_resource",
          arguments: {},
        },
      },
    ]);

    expect(milestones.map((milestone) => milestone.step)).toEqual([
      "codex-sentry-breadcrumbs",
      "codex-sentry-issue",
    ]);
  });

  it("parses valid JSONL lines and skips malformed lines", () => {
    const raw = [
      '{"type":"item.completed","item":{"type":"mcp_tool_call","server":"sentry-bubble-reel","tool":"get_sentry_resource"}}',
      "{ not valid json }",
      '   {"type":"item.completed","item":{"type":"mcp_tool_call","server":"chrome-devtools","tool":"take_snapshot"}}   ',
    ].join("\n");

    const events = parseCodexEvents(raw);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.item?.server)).toEqual(["sentry-bubble-reel", "chrome-devtools"]);
  });
});
