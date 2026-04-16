import { readFile } from "node:fs/promises";

export interface TimelineEvent {
  step: string;
  status: "started" | "completed" | "failed";
  startedAt: string;
  endedAt: string;
  summary: string;
  payload: Record<string, unknown>;
}

export async function readTimelineEvents(timelinePath: string): Promise<TimelineEvent[]> {
  try {
    const raw = await readFile(timelinePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TimelineEvent);
  } catch {
    return [];
  }
}
