import { eventQueue } from "@/app/lib/redis";
import { NextResponse } from "next/server";
// import { eventQueue } from "@/lib/redis";

export async function GET() {
  try {
    const health = await eventQueue.checkHealth();
    return NextResponse.json({
      ok: true,
      ...health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Health check failed" },
      { status: 500 }
    );
  }
}
