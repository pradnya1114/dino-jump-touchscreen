import { NextRequest, NextResponse } from "next/server";
import { desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { cleanName, getLastResetCutoff, parseKioskTime, toInt } from "@/db/helpers";
import { gameRecords } from "@/db/schema";

export const dynamic = "force-dynamic";

// GET /api/scores?view=top|all&limit=10
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view") ?? "top";
    const requested = Number(searchParams.get("limit") ?? "10") || 10;
    const lastResetCutoff = await getLastResetCutoff();
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(gameRecords);

    if (view === "all") {
      const rows = await db
        .select()
        .from(gameRecords)
        .orderBy(desc(gameRecords.createdAt))
        .limit(Math.max(1, Math.min(10000, requested)));
      return NextResponse.json({ ok: true, view, count, records: rows, lastResetCutoff });
    }

    // default: top leaderboard sorted highest -> lowest
    const rows = await db
      .select()
      .from(gameRecords)
      .orderBy(desc(gameRecords.score), desc(gameRecords.createdAt))
      .limit(Math.max(1, Math.min(100, requested)));
    const best = rows.length > 0 ? rows[0].score : 0;
    return NextResponse.json({ ok: true, view: "top", count, best, records: rows, lastResetCutoff });
  } catch (err) {
    console.error("GET /api/scores failed:", err);
    return NextResponse.json(
      { ok: false, error: "Database unavailable. Please try again." },
      { status: 500 },
    );
  }
}

// POST /api/scores — save one completed game (idempotent via gameId).
// `playedAt` is optional: kiosks send the time the game really ended.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const gameId = typeof body.gameId === "string" ? body.gameId.trim().slice(0, 64) : "";
    const playerName = cleanName(body.playerName);
    const score = toInt(body.score);
    const jumps = toInt(body.jumps, 100000);
    const obstaclesDodged = toInt(body.obstaclesDodged, 100000);
    const durationMs = toInt(body.durationMs, 3_600_000);
    const topSpeed = toInt(body.topSpeed, 100000);

    if (!gameId) {
      return NextResponse.json({ ok: false, error: "Missing gameId." }, { status: 400 });
    }
    if (!playerName) {
      return NextResponse.json({ ok: false, error: "Player name is required." }, { status: 400 });
    }

    // Idempotency: never store the same game twice.
    const existing = await db
      .select()
      .from(gameRecords)
      .where(eq(gameRecords.gameId, gameId))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ ok: true, duplicate: true, record: existing[0] });
    }

    const [record] = await db
      .insert(gameRecords)
      .values({
        gameId,
        playerName,
        score,
        jumps,
        obstaclesDodged,
        durationMs,
        topSpeed,
        ...(body.playedAt !== undefined ? { createdAt: parseKioskTime(body.playedAt) } : {}),
      })
      .returning();

    // Rank of this score (1-based) among all records.
    let rank = 1;
    try {
      const [{ better }] = await db
        .select({ better: sql<number>`count(*)::int` })
        .from(gameRecords)
        .where(gt(gameRecords.score, score));
      rank = (better ?? 0) + 1;
    } catch {
      rank = 1;
    }

    return NextResponse.json({ ok: true, record, rank }, { status: 201 });
  } catch (err: unknown) {
    console.error("POST /api/scores failed:", err);
    const msg = err instanceof Error ? err.message : "";
    // Unique violation -> treat as duplicate, not an error.
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json(
      { ok: false, error: "Could not save score. Please try again." },
      { status: 500 },
    );
  }
}
