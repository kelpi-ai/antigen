import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const CDPMock = vi.fn();
const spawnMock = vi.fn();

vi.mock("chrome-remote-interface", () => ({ default: (...args: unknown[]) => CDPMock(...args) }));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) };
});

import { startBrowserRecording } from "../../src/browser/record";

function fakeFfmpegProcess(): EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
} {
  const ffmpeg = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };
  ffmpeg.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  return ffmpeg;
}

describe("startBrowserRecording", () => {
  beforeEach(() => {
    CDPMock.mockReset();
    spawnMock.mockReset();
  });

  it("starts Page screencast and returns a stop function", async () => {
    const page = {
      startScreencast: vi.fn(),
      stopScreencast: vi.fn(),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn(),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    spawnMock.mockReturnValue(ffmpeg);

    const recording = await startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    expect(page.startScreencast).toHaveBeenCalled();
    expect(typeof recording.stop).toBe("function");
  });

  it("writes frame data to ffmpeg stdin and acks each screencast frame", async () => {
    let onFrame: ((frame: { data: string; sessionId: number }) => void | Promise<void>) | undefined;
    const page = {
      startScreencast: vi.fn(),
      stopScreencast: vi.fn(),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn((handler: (frame: { data: string; sessionId: number }) => void) => {
        onFrame = handler;
        return vi.fn();
      }),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    spawnMock.mockReturnValue(ffmpeg);

    await startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    const rawFrame = Buffer.from("png-bytes");
    await onFrame?.({ data: rawFrame.toString("base64"), sessionId: 9 });

    expect(ffmpeg.stdin.write).toHaveBeenCalledWith(rawFrame);
    expect(page.screencastFrameAck).toHaveBeenCalledWith({ sessionId: 9 });
  });

  it("stop() stops screencast, ends ffmpeg stdin, and closes the CDP client", async () => {
    const page = {
      startScreencast: vi.fn(),
      stopScreencast: vi.fn(),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn(),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    spawnMock.mockReturnValue(ffmpeg);

    const recording = await startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    await recording.stop();

    expect(page.stopScreencast).toHaveBeenCalledTimes(1);
    expect(ffmpeg.stdin.end).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
