import { describe, it, expect } from "vitest";
import { extractTaggedJson } from "../../src/p3/parse";

describe("extractTaggedJson", () => {
  it("parses a tagged JSON object", () => {
    const text = 'noise\nP3_PLANNER_JSON {"previewUrl":"https://pr-1.preview.dev","scenarios":[]}\n';
    expect(
      extractTaggedJson<{ previewUrl: string; scenarios: unknown[] }>(
        text,
        "P3_PLANNER_JSON",
      ),
    ).toEqual({
      previewUrl: "https://pr-1.preview.dev",
      scenarios: [],
    });
  });

  it("uses the latest tagged line when duplicates exist", () => {
    const text =
      'P3_PLANNER_JSON {"previewUrl":"https://old.preview.dev","scenarios":[]}\n' +
      'P3_PLANNER_JSON {"previewUrl":"https://new.preview.dev","scenarios":[]}';

    expect(
      extractTaggedJson<{ previewUrl: string; scenarios: unknown[] }>(text, "P3_PLANNER_JSON"),
    ).toEqual({
      previewUrl: "https://new.preview.dev",
      scenarios: [],
    });
  });

  it("wraps malformed tagged payloads with tag context", () => {
    const text = 'P3_PLANNER_JSON {"previewUrl":}';

    expect(() =>
      extractTaggedJson<{ previewUrl: string }>(text, "P3_PLANNER_JSON"),
    ).toThrow(/P3_PLANNER_JSON/);
  });

  it("throws when the tag is missing", () => {
    expect(() => extractTaggedJson("{}", "P3_EXECUTOR_JSON")).toThrow(
      /P3_EXECUTOR_JSON/,
    );
  });
});
