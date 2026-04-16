import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface StitchScreenshotsInput {
  screenshotsDir: string;
  outputPath: string;
  ffmpegBin: string;
}

export interface StitchScreenshotsResult {
  created: boolean;
  framePaths: string[];
}

function byFrameName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function waitForProcess(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      const suffix = signal ? `, signal ${signal}` : "";
      reject(new Error(`ffmpeg exited (code ${String(code)}${suffix})`));
    };
    const cleanup = (): void => {
      child.off("error", onError);
      child.off("close", onClose);
    };

    child.once("error", onError);
    child.once("close", onClose);
  });
}

function buildConcatManifest(framePaths: string[]): string {
  const lines: string[] = [];

  for (const framePath of framePaths) {
    const escaped = framePath.replaceAll("'", "'\\''");
    lines.push(`file '${escaped}'`);
    lines.push("duration 1");
  }

  if (framePaths.length > 0) {
    const last = framePaths.at(-1)?.replaceAll("'", "'\\''") ?? "";
    lines.push(`file '${last}'`);
  }

  return `${lines.join("\n")}\n`;
}

export async function stitchScreenshotsToVideo(
  input: StitchScreenshotsInput,
): Promise<StitchScreenshotsResult> {
  const entries = await readdir(input.screenshotsDir, { withFileTypes: true }).catch(() => []);
  const framePaths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => join(input.screenshotsDir, entry.name))
    .sort(byFrameName);

  if (framePaths.length === 0) {
    return { created: false, framePaths: [] };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "incident-loop-ffmpeg-"));
  const manifestPath = join(tempDir, "frames.txt");

  try {
    await writeFile(manifestPath, buildConcatManifest(framePaths));

    const ffmpeg = spawn(
      input.ffmpegBin,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        manifestPath,
        "-vf",
        "fps=30,format=yuv420p",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        input.outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    await waitForProcess(ffmpeg);
    return { created: true, framePaths };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
