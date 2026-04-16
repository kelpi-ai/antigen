import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { stitchScreenshotsToVideo } from "../../src/browser/stitch";

describe("stitchScreenshotsToVideo", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("skips ffmpeg when there are no screenshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "incident-loop-video-"));
    const screenshotsDir = join(root, "screenshots");
    await mkdir(screenshotsDir, { recursive: true });

    const result = await stitchScreenshotsToVideo({
      screenshotsDir,
      outputPath: join(root, "browser.mp4"),
      ffmpegBin: "ffmpeg",
    });

    expect(result).toEqual({ created: false, framePaths: [] });
    expect(spawnMock).not.toHaveBeenCalled();

    await rm(root, { recursive: true, force: true });
  });

  it("builds a concat video from saved screenshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "incident-loop-video-"));
    const screenshotsDir = join(root, "screenshots");
    await mkdir(screenshotsDir, { recursive: true });
    const firstFrame = join(screenshotsDir, "01-start.png");
    const secondFrame = join(screenshotsDir, "02-error.png");
    await writeFile(firstFrame, "frame-1");
    await writeFile(secondFrame, "frame-2");

    const child = new EventEmitter() as EventEmitter & {
      once: EventEmitter["once"];
      off: EventEmitter["off"];
    };
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.emit("close", 0, null);
      });
      return child;
    });

    const outputPath = join(root, "browser.mp4");
    const result = await stitchScreenshotsToVideo({
      screenshotsDir,
      outputPath,
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    expect(result).toEqual({
      created: true,
      framePaths: [firstFrame, secondFrame],
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "/opt/homebrew/bin/ffmpeg",
      expect.arrayContaining(["-f", "concat", "-safe", "0", "-i", expect.stringContaining("frames.txt"), outputPath]),
      expect.objectContaining({ stdio: ["ignore", "ignore", "pipe"] }),
    );

    await rm(root, { recursive: true, force: true });
  });
});
