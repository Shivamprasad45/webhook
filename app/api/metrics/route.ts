import { eventQueue } from "@/app/lib/redis";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const metrics = await eventQueue.getMetrics();
    return NextResponse.json({
      ...metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get metrics" },
      { status: 500 }
    );
  }
}
