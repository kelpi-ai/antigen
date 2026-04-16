import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyHmacSha256 } from "../../src/webhooks/verify";

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHmacSha256", () => {
  const body = JSON.stringify({ ok: true });
  const secret = "shh";

  it("returns true for a valid GitHub-style signature", () => {
    expect(
      verifyHmacSha256({
        body,
        secret,
        signature: sign(body, secret),
      }),
    ).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    expect(
      verifyHmacSha256({
        body,
        secret,
        signature: "sha256=deadbeef",
      }),
    ).toBe(false);
  });

  it("returns false when the signature is missing the prefix", () => {
    expect(
      verifyHmacSha256({
        body,
        secret,
        signature: "deadbeef",
      }),
    ).toBe(false);
  });
});
