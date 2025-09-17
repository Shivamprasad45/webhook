import { eventQueue } from "@/app/lib/redis";
import { NextRequest, NextResponse } from "next/server";
// import { eventQueue } from "@/lib/redis";

export async function POST(request: NextRequest) {
  try {
    const { event_id } = await request.json();

    if (!event_id) {
      return NextResponse.json(
        { error: "event_id is required" },
        { status: 400 }
      );
    }

    const success = await eventQueue.replayEvent(event_id);

    return NextResponse.json({
      success,
      message: success ? "Event replayed successfully" : "Event not found",
    });
  } catch (error) {
    console.error("Replay error:", error);
    return NextResponse.json(
      { error: "Failed to replay event" },
      { status: 500 }
    );
  }
}
