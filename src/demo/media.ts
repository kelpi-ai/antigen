import { resolve as resolvePath, sep } from "node:path";

interface ResolveDemoMediaInput {
  artifactsRoot: string;
  runId: string;
}

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function ensureTrailingSeparator(path: string): string {
  return path.endsWith(sep) ? path : `${path}${sep}`;
}

export function resolveDemoBrowserMp4Path(input: ResolveDemoMediaInput): string | null {
  if (!input.runId || !RUN_ID_PATTERN.test(input.runId)) {
    return null;
  }

  const safeRunsRoot = resolvePath(input.artifactsRoot, "runs");
  const safeRunDir = resolvePath(safeRunsRoot, input.runId);
  const safeRunsRootWithSep = ensureTrailingSeparator(safeRunsRoot);

  if (!safeRunDir.startsWith(safeRunsRootWithSep)) {
    return null;
  }

  return resolvePath(safeRunDir, "browser.mp4");
}
