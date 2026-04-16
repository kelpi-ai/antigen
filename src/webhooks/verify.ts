import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyInput {
  body: string;
  signature: string;
  secret: string;
}

export function verifyHmacSha256({ body, signature, secret }: VerifyInput): boolean {
  const strippedSignature = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
  const expectedSignature = createHmac("sha256", secret).update(body).digest("hex");

  if (strippedSignature.length !== expectedSignature.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(strippedSignature, "hex"), Buffer.from(expectedSignature, "hex"));
  } catch {
    return false;
  }
}
