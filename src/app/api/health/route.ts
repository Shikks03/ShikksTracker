import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    return NextResponse.json({ ok: true, db: "unconfigured" });
  }

  try {
    await connectDB();
    return NextResponse.json({ ok: true, db: "connected" });
  } catch {
    return NextResponse.json({ ok: false, db: "error" }, { status: 503 });
  }
}
