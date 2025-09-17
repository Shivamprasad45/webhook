// src/app/api/admin/events/route.ts
import { eventQueue } from "@/app/lib/redis";
import { NextResponse } from "next/server";
// import { eventQueue } from '@/lib/redis';

export async function GET() {
  try {
    const events = await eventQueue.getRecentEvents(20);
    return NextResponse.json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
