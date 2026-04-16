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

  it("accepts signatures with the sha256= prefix", () => {
    const body = '{"ok":true}';
    expect(
      verifyHmacSha256({
        body,
        signature: `sha256=${sign(body, "topsecret")}`,
        secret: "topsecret",
      }),
    ).toBe(true);
  });

  it("returns false for signatures with the wrong length", () => {
    expect(
      verifyHmacSha256({
        body: '{"ok":true}',
        signature: "abcd",
        secret: "topsecret",
      }),
    ).toBe(false);
  });

  it("returns false for malformed hexadecimal signatures", () => {
    expect(
      verifyHmacSha256({
        body: '{"ok":true}',
        signature: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        secret: "topsecret",
      }),
    ).toBe(false);
  });
});
