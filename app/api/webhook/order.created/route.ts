// src/app/api/webhook/order.created/route.ts
import { eventQueue } from "@/app/lib/redis";
import {
  rateLimiter,
  verifyTimestamp,
  verifyWebhookSignature,
} from "@/app/lib/webhook";
import { NextRequest, NextResponse } from "next/server";
// import { eventQueue } from '@/lib/redis';
// import { verifyWebhookSignature, verifyTimestamp, rateLimiter } from '@/lib/webhook';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Rate limiting
    const ip =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "127.0.0.1";

    const { allowed, remaining } = await rateLimiter.checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: { "X-RateLimit-Remaining": remaining.toString() },
        }
      );
    }

    // Get headers
    const signature = request.headers.get("x-signature");
    const timestamp = request.headers.get("x-timestamp");

    if (!signature || !timestamp) {
      return NextResponse.json(
        { error: "Missing required headers" },
        { status: 400 }
      );
    }

    // Verify timestamp
    if (!verifyTimestamp(timestamp)) {
      return NextResponse.json({ error: "Request too old" }, { status: 400 });
    }

    // Get raw body for signature verification
    const rawBody = await request.text();

    // Verify signature
    const webhookSecret = process.env.WEBHOOK_SECRET!;
    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse JSON
    let eventData;
    try {
      eventData = JSON.parse(rawBody);
    } catch (error) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Validate required fields
    if (!eventData.event_id || !eventData.type || !eventData.data) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Prepare event for queue
    const event = {
      ...eventData,
      timestamp: parseInt(timestamp),
      status: "queued" as const,
      retry_count: 0,
    };

    // Add to queue (handles deduplication)
    const added = await eventQueue.addEvent(event);

    const processingTime = Date.now() - startTime;
    console.log(`Webhook processed in ${processingTime}ms, added: ${added}`);

    return NextResponse.json({
      success: true,
      event_id: eventData.event_id,
      duplicate: !added,
      processing_time_ms: processingTime,
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
