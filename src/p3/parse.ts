export function extractTaggedJson<T>(text: string, tag: string): T {
  let line: string | undefined;

  for (const entry of text.split("\n").map((entry) => entry.trim())) {
    if (entry.startsWith(`${tag} `)) {
      line = entry;
    }
  }

  if (!line) {
    throw new Error(`Missing ${tag} line in Codex output`);
  }

  try {
    return JSON.parse(line.slice(tag.length + 1)) as T;
  } catch (error) {
    throw new Error(
      `Invalid JSON payload for ${tag}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
