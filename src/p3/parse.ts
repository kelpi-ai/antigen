export function extractTaggedJson<T>(text: string, tag: string): T {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${tag} `));

  if (!line) {
    throw new Error(`Missing ${tag} line in Codex output`);
  }

  return JSON.parse(line.slice(tag.length + 1)) as T;
}
