// src/lib/webhook.ts
import { createHmac } from "crypto";
import { redis } from "./redis";

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  const receivedSignature = signature.replace("sha256=", "");
  return expectedSignature === receivedSignature;
}

export function verifyTimestamp(timestamp: string): boolean {
  const eventTime = parseInt(timestamp);
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 5 * 60; // 5 minutes

  return now - eventTime <= maxAge;
}

export class RateLimiter {
  private keyPrefix = "rate_limit:";
  private maxRequests = 10;
  private windowSeconds = 10;

  async checkRateLimit(
    ip: string
  ): Promise<{ allowed: boolean; remaining: number }> {
    const key = `${this.keyPrefix}${ip}`;
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, this.windowSeconds);
    }

    const remaining = Math.max(0, this.maxRequests - current);
    return {
      allowed: current <= this.maxRequests,
      remaining,
    };
  }
}

export const rateLimiter = new RateLimiter();
