import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHmacSha256 } from "../../src/webhooks/verify";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHmacSha256", () => {
  it("returns true for a valid signature", () => {
    expect(
      verifyHmacSha256({
        body: '{"ok":true}',
        signature: sign('{"ok":true}', "topsecret"),
        secret: "topsecret",
      }),
    ).toBe(true);
  });
});
