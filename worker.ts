// worker.ts (root level)
// import { eventQueue, EventData } from './src/lib/redis';
// import { sendFCMNotification } from './src/lib/firebase';

import { sendFCMNotification } from "./app/lib/firebase";
import { EventData, eventQueue } from "./app/lib/redis";

class EventWorker {
  private isRunning = false;
  private maxRetries = 3;

  async start() {
    console.log("🔄 Starting event worker...");
    await eventQueue.init();
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.processEvents();
      } catch (error) {
        console.error("Worker error:", error);
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5s on error
      }
    }
  }

  async processEvents() {
    const events = await eventQueue.consumeEvents();

    for (const event of events) {
      console.log(`📥 Processing event: ${event.event_id}`);

      try {
        await this.handleEvent(event);
        await eventQueue.ackEvent(event.messageId);
        await eventQueue.incrementMetric("sent");
        console.log(`✅ Event ${event.event_id} processed successfully`);
      } catch (error) {
        console.error(`❌ Event ${event.event_id} failed:`, error);
        await this.handleFailure(event);
      }
    }
  }

  async handleEvent(event: EventData) {
    const { data } = event;

    // Get FCM token for user
    let fcmToken = await eventQueue.getFCMToken(data.userId);

    // Prepare FCM message
    const message = {
      title: "New Order",
      body: `Order ${data.order_id} placed by ${data.userId}`,
      ...(fcmToken ? { token: fcmToken } : { topic: "orders" }),
    };

    // Send FCM notification
    const success = await sendFCMNotification(message);

    if (!success) {
      throw new Error("Failed to send FCM notification");
    }

    console.log(`🔔 FCM sent for order ${data.order_id}`);
  }

  async handleFailure(event: EventData) {
    const retryCount = (event.retry_count || 0) + 1;

    if (retryCount >= this.maxRetries) {
      console.log(
        `💀 Moving event ${event.event_id} to DLQ after ${retryCount} retries`
      );
      await eventQueue.moveToDLQ({ ...event, retry_count: retryCount });
      await eventQueue.ackEvent(event.messageId);
      return;
    }

    // Calculate exponential backoff: 1s, 4s, 10s
    const delays = [1000, 4000, 10000];
    const delay = delays[retryCount - 1] || 10000;

    console.log(
      `🔄 Retrying event ${event.event_id} in ${delay}ms (attempt ${retryCount})`
    );

    await eventQueue.incrementMetric("failed");
    await eventQueue.ackEvent(event.messageId);

    // Re-queue after delay
    setTimeout(async () => {
      const retryEvent = {
        ...event,
        retry_count: retryCount,
        status: "queued" as const,
      };
      await eventQueue.addEvent(retryEvent);
    }, delay);
  }

  stop() {
    console.log("🛑 Stopping worker...");
    this.isRunning = false;
  }
}

// Handle graceful shutdown
const worker = new EventWorker();

process.on("SIGINT", () => {
  console.log("\n👋 Received SIGINT, shutting down gracefully...");
  worker.stop();
  setTimeout(() => process.exit(0), 2000);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Received SIGTERM, shutting down gracefully...");
  worker.stop();
  setTimeout(() => process.exit(0), 2000);
});

// Start the worker
worker.start().catch(console.error);
