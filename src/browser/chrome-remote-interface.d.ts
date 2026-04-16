declare module "chrome-remote-interface" {
  export interface ConnectOptions {
    port?: number;
  }

  export default function CDP(options?: ConnectOptions): Promise<unknown>;
}
