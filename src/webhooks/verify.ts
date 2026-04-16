import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyHmacInput {
  body: string;
  secret: string;
  signature: string;
}

export function verifyHmacSha256({
  body,
  secret,
  signature,
}: VerifyHmacInput): boolean {
  const prefix = "sha256=";
  if (!signature.startsWith(prefix)) {
    return false;
  }

  const expected = prefix + createHmac("sha256", secret).update(body).digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
