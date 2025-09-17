// src/lib/redis.ts
import Redis from "ioredis";

export const redis = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379"
);

export interface EventData {
  event_id: string;
  type: string;
  data: {
    order_id: string;
    userId: string;
    amount: number;
  };
  timestamp: number;
  status: "queued" | "processing" | "sent" | "failed";
  retry_count?: number;
  messageId?: string;
}

export class EventQueue {
  private streamName = "orders-stream";
  private dlqName = "orders-dlq";
  private consumerGroup = "workers";
  private consumerName = "worker-1";

  async init() {
    try {
      await redis.xgroup(
        "CREATE",
        this.streamName,
        this.consumerGroup,
        "0",
        "MKSTREAM"
      );
    } catch (error: any) {
      if (!error.message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

  async addEvent(event: EventData): Promise<boolean> {
    // Check idempotency (24h)
    const exists = await redis.get(`event:${event.event_id}`);
    if (exists) {
      await this.incrementMetric("deduped");
      return false;
    }

    // Set 24h expiry for deduplication
    await redis.setex(
      `event:${event.event_id}`,
      24 * 60 * 60,
      JSON.stringify(event)
    );

    // Add to stream
    await redis.xadd(this.streamName, "*", "data", JSON.stringify(event));

    await this.incrementMetric("received");
    return true;
  }

  async consumeEvents(): Promise<EventData[]> {
    const results = await redis.xreadgroup(
      "GROUP",
      this.consumerGroup,
      this.consumerName,
      "COUNT",
      "1",
      "BLOCK",
      "1000",
      "STREAMS",
      this.streamName,
      ">"
    );

    if (!results?.length) return [];

    const [stream, messages] = results[0];
    return messages.map(([id, fields]) => {
      const data = JSON.parse(fields[1]);
      return { ...data, messageId: id };
    });
  }

  async ackEvent(messageId: string) {
    await redis.xack(this.streamName, this.consumerGroup, messageId);
  }

  async moveToDLQ(event: EventData) {
    await redis.lpush(
      this.dlqName,
      JSON.stringify({ ...event, status: "failed" })
    );
    await this.incrementMetric("dlq");
  }

  async replayEvent(eventId: string): Promise<boolean> {
    const eventData = await redis.get(`event:${eventId}`);
    if (!eventData) return false;

    const event = JSON.parse(eventData);
    event.status = "queued";
    event.retry_count = 0;

    await redis.xadd(this.streamName, "*", "data", JSON.stringify(event));
    return true;
  }

  async getRecentEvents(limit = 20): Promise<EventData[]> {
    const events: EventData[] = [];

    // Get from stream
    const streamResults = await redis.xrevrange(
      this.streamName,
      "+",
      "-",
      "COUNT",
      limit
    );
    for (const [id, fields] of streamResults) {
      const event = JSON.parse(fields[1]);
      events.push({ ...event, messageId: id });
    }

    // Get from DLQ
    const dlqResults = await redis.lrange(this.dlqName, 0, limit);
    for (const item of dlqResults) {
      events.push(JSON.parse(item));
    }

    return events.slice(0, limit);
  }

  async getFCMToken(userId: string): Promise<string | null> {
    return redis.get(`fcm:token:${userId}`);
  }

  async setFCMToken(userId: string, token: string) {
    await redis.set(`fcm:token:${userId}`, token);
  }

  async incrementMetric(metric: string) {
    await redis.incr(`metrics:${metric}`);
  }

  async getMetrics() {
    const keys = ["received", "deduped", "sent", "failed", "dlq"];
    const values = await redis.mget(...keys.map((k) => `metrics:${k}`));

    return keys.reduce((acc, key, idx) => {
      acc[key] = parseInt(values[idx] || "0");
      return acc;
    }, {} as Record<string, number>);
  }

  async checkHealth(): Promise<{ redis: string }> {
    try {
      await redis.ping();
      return { redis: "up" };
    } catch (error) {
      return { redis: "down" };
    }
  }
}

export const eventQueue = new EventQueue();
