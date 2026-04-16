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

  const unsubscribeFrame = client.Page.screencastFrame(async ({ data, sessionId }) => {
    ffmpegStdin.write(Buffer.from(data, "base64"));
    await client.Page.screencastFrameAck({ sessionId });
  });

  await client.Page.startScreencast();

  let stopped = false;

  return {
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;

      if (typeof unsubscribeFrame === "function") {
        unsubscribeFrame();
      }
      await client.Page.stopScreencast();
      ffmpegStdin.end();
      await client.close();
    },
  };
}
