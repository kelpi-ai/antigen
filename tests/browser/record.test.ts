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

type MockFfmpegProcess = EventEmitter & {
  stdin: EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
};

function fakeFfmpegProcess(): MockFfmpegProcess {
  const ffmpeg = new EventEmitter() as MockFfmpegProcess;
  const stdin = new EventEmitter() as MockFfmpegProcess["stdin"];

  stdin.write = vi.fn();
  stdin.end = vi.fn();
  ffmpeg.kill = vi.fn();

  ffmpeg.stdin = {
    ...stdin,
    write: stdin.write,
    end: stdin.end,
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
    ffmpeg.stdin.end.mockImplementation(() => {
      ffmpeg.emit("close", 0, null);
    });
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

  it("waits for ffmpeg to finish before stop() resolves", async () => {
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

    let settled = false;
    const stopPromise = recording.stop().finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    ffmpeg.emit("close", 0, null);
    await stopPromise;
    expect(settled).toBe(true);
  });

  it("waits for screencast shutdown before ending ffmpeg stdin", async () => {
    let resolveStopScreencast: (() => void) | undefined;
    const page = {
      startScreencast: vi.fn(),
      stopScreencast: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveStopScreencast = resolve;
          }),
      ),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn(),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    ffmpeg.stdin.end.mockImplementation(() => {
      ffmpeg.emit("close", 0, null);
    });
    spawnMock.mockReturnValue(ffmpeg);

    const recording = await startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    const stopPromise = recording.stop();
    await Promise.resolve();

    expect(page.stopScreencast).toHaveBeenCalledTimes(1);
    expect(ffmpeg.stdin.end).not.toHaveBeenCalled();

    resolveStopScreencast?.();
    await stopPromise;

    expect(ffmpeg.stdin.end).toHaveBeenCalledTimes(1);
  });

  it("rolls back ffmpeg and CDP client when startScreencast rejects", async () => {
    const unsubscribe = vi.fn();
    const page = {
      startScreencast: vi.fn().mockRejectedValue(new Error("start failed")),
      stopScreencast: vi.fn(),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn(() => unsubscribe),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    ffmpeg.stdin.end.mockImplementation(() => {
      ffmpeg.emit("close", 0, null);
    });
    spawnMock.mockReturnValue(ffmpeg);

    await expect(
      startBrowserRecording({
        port: 9222,
        outputPath: "/tmp/browser.mp4",
        ffmpegBin: "/opt/homebrew/bin/ffmpeg",
      }),
    ).rejects.toThrow(/start failed/);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(ffmpeg.stdin.end).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("calls unsubscribe callback on stop()", async () => {
    const unsubscribe = vi.fn();
    const page = {
      startScreencast: vi.fn(),
      stopScreencast: vi.fn(),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn(() => unsubscribe),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    ffmpeg.stdin.end.mockImplementation(() => {
      ffmpeg.emit("close", 0, null);
    });
    spawnMock.mockReturnValue(ffmpeg);

    const recording = await startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    await recording.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("continues stop cleanup if stopScreencast rejects", async () => {
    const unsubscribe = vi.fn();
    const page = {
      startScreencast: vi.fn(),
      stopScreencast: vi.fn().mockRejectedValue(new Error("stop failed")),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn(() => unsubscribe),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    ffmpeg.stdin.end.mockImplementation(() => {
      ffmpeg.emit("close", 0, null);
    });
    spawnMock.mockReturnValue(ffmpeg);

    const recording = await startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    await expect(recording.stop()).rejects.toThrow(/stop failed/);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(ffmpeg.stdin.end).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("ignores expected DevTools websocket close errors during stop()", async () => {
    const disconnectError = new Error("WebSocket connection closed");
    const unsubscribe = vi.fn();
    const page = {
      startScreencast: vi.fn(),
      stopScreencast: vi.fn().mockRejectedValue(disconnectError),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn(() => unsubscribe),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn().mockRejectedValue(disconnectError) };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    ffmpeg.stdin.end.mockImplementation(() => {
      ffmpeg.emit("close", 0, null);
    });
    spawnMock.mockReturnValue(ffmpeg);

    const recording = await startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });

    await expect(recording.stop()).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(ffmpeg.stdin.end).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("rejects startup when ffmpeg emits an error", async () => {
    const page = {
      startScreencast: vi.fn(() => new Promise<void>(() => {})),
      stopScreencast: vi.fn(),
      screencastFrameAck: vi.fn(),
      screencastFrame: vi.fn(),
    };
    const client = { Page: page, Runtime: { enable: vi.fn() }, close: vi.fn() };
    CDPMock.mockResolvedValue(client);

    const ffmpeg = fakeFfmpegProcess();
    spawnMock.mockReturnValue(ffmpeg);

    const startupPromise = startBrowserRecording({
      port: 9222,
      outputPath: "/tmp/browser.mp4",
      ffmpegBin: "/opt/homebrew/bin/ffmpeg",
    });
    await Promise.resolve();
    ffmpeg.emit("error", new Error("ffmpeg crashed"));

    await expect(startupPromise).rejects.toThrow(/ffmpeg crashed/);
    expect(ffmpeg.stdin.end).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
