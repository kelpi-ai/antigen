import { spawn } from "node:child_process";
import CDP from "chrome-remote-interface";

interface ScreencastFramePayload {
  data: string;
  sessionId: number;
}

interface PageDomain {
  startScreencast(params?: Record<string, unknown>): Promise<void>;
  stopScreencast(): Promise<void>;
  screencastFrameAck(input: { sessionId: number }): Promise<void>;
  screencastFrame(
    handler: (payload: ScreencastFramePayload) => void | Promise<void>,
  ): (() => void) | void;
}

interface CdpClient {
  Page: PageDomain;
  close(): Promise<void>;
}

export interface BrowserRecording {
  stop(): Promise<void>;
}

function asError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

function formatFfmpegExitError(input: {
  code: number | null;
  signal: NodeJS.Signals | null;
  context: "startup" | "runtime";
}): Error {
  const suffix = input.signal ? `, signal ${input.signal}` : "";
  const code = input.code === null ? "null" : String(input.code);
  if (input.context === "startup") {
    return new Error(`ffmpeg exited before screencast started (code ${code}${suffix})`);
  }
  return new Error(`ffmpeg exited (code ${code}${suffix})`);
}

function createFfmpegCompletionPromise(ffmpeg: ReturnType<typeof spawn>): Promise<void> {
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
      reject(formatFfmpegExitError({ code, signal, context: "runtime" }));
    };
    const cleanup = (): void => {
      ffmpeg.off("error", onError);
      ffmpeg.off("close", onClose);
    };

    ffmpeg.once("error", onError);
    ffmpeg.once("close", onClose);
  });
}

function createFfmpegStartupFailurePromise(ffmpeg: ReturnType<typeof spawn>): {
  promise: Promise<never>;
  dispose: () => void;
} {
  let onError: ((error: Error) => void) | undefined;
  let onClose: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

  const promise = new Promise<never>((_resolve, reject) => {
    onError = (error: Error) => {
      dispose();
      reject(error);
    };
    onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      dispose();
      reject(formatFfmpegExitError({ code, signal, context: "startup" }));
    };
    ffmpeg.once("error", onError);
    ffmpeg.once("close", onClose);
  });

  function dispose(): void {
    if (onError) {
      ffmpeg.off("error", onError);
      onError = undefined;
    }
    if (onClose) {
      ffmpeg.off("close", onClose);
      onClose = undefined;
    }
  }

  return { promise, dispose };
}

export async function startBrowserRecording(input: {
  port: number;
  outputPath: string;
  ffmpegBin: string;
}): Promise<BrowserRecording> {
  const client = (await CDP({ port: input.port })) as CdpClient;
  const ffmpeg = spawn(
    input.ffmpegBin,
    [
      "-y",
      "-f",
      "image2pipe",
      "-framerate",
      "30",
      "-i",
      "pipe:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      input.outputPath,
    ],
    { stdio: ["pipe", "ignore", "ignore"] },
  );

  const ffmpegStdin = ffmpeg.stdin;
  if (!ffmpegStdin) {
    await client.close();
    throw new Error("ffmpeg stdin is not available");
  }

  const ffmpegCompletion = createFfmpegCompletionPromise(ffmpeg);
  ffmpegCompletion.catch(() => {
    // Prevent unhandled rejections when failure occurs before stop() observes it.
  });

  let unsubscribeFrame: (() => void) | void = undefined;
  unsubscribeFrame = client.Page.screencastFrame(async ({ data, sessionId }) => {
    ffmpegStdin.write(Buffer.from(data, "base64"));
    await client.Page.screencastFrameAck({ sessionId });
  });

  const ffmpegStartupFailure = createFfmpegStartupFailurePromise(ffmpeg);
  try {
    await Promise.race([client.Page.startScreencast(), ffmpegStartupFailure.promise]);
    ffmpegStartupFailure.dispose();
  } catch (error) {
    ffmpegStartupFailure.dispose();

    if (typeof unsubscribeFrame === "function") {
      try {
        unsubscribeFrame();
      } catch {
        // Ignore unsubscribe cleanup errors while rolling back startup.
      }
    }
    try {
      ffmpegStdin.end();
    } catch {
      // Ignore stdin cleanup errors while rolling back startup.
    }
    try {
      ffmpeg.kill("SIGTERM");
    } catch {
      // Ignore kill errors for already-exited child processes.
    }
    await Promise.allSettled([ffmpegCompletion, Promise.resolve(client.close())]);
    throw error;
  }

  let stopped = false;

  return {
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;

      const cleanupErrors: Error[] = [];

      if (typeof unsubscribeFrame === "function") {
        try {
          unsubscribeFrame();
        } catch (error) {
          cleanupErrors.push(asError(error));
        }
      }
      try {
        ffmpegStdin.end();
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
      const results = await Promise.allSettled([
        Promise.resolve(client.Page.stopScreencast()),
        ffmpegCompletion,
        Promise.resolve(client.close()),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          cleanupErrors.push(asError(result.reason));
        }
      }

      if (cleanupErrors.length > 0) {
        throw cleanupErrors[0];
      }
    },
  };
}
