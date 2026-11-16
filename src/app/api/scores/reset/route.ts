import { NextRequest, NextResponse } from "next/server";
import { inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { parseKioskTime, resetBatch } from "@/db/helpers";
import { gameRecords, gameRecordsArchive } from "@/db/schema";

export const dynamic = "force-dynamic";

// POST /api/scores/reset  { confirm: "RESET", before?, gameIds? }
// Secure flow: copy the records into game_records_archive first, then clear.
//   before   — time of the reset (defaults to now). A kiosk that was reset while
//              offline sends the real time, so games played after that reset
//              stay on the leaderboard.
//   gameIds  — games the kiosk cleared; archived even if their clock disagrees.
// Safe to repeat.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.confirm !== "RESET") {
      return NextResponse.json(
        { ok: false, error: "Confirmation required. Send { confirm: 'RESET' }." },
        { status: 400 },
      );
    }

    const cutoff = body.before !== undefined ? parseKioskTime(body.before) : new Date();
    const batch = resetBatch(cutoff);
    const gameIds = Array.isArray(body.gameIds)
      ? body.gameIds.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 5000)
      : [];

    // "up to and including the reset time" (+1 ms: the database keeps finer time than the kiosk sends)
    const upTo = new Date(cutoff.getTime() + 1);
    const affected =
      gameIds.length > 0
        ? or(lt(gameRecords.createdAt, upTo), inArray(gameRecords.gameId, gameIds))
        : lt(gameRecords.createdAt, upTo);

    const cleared = await db.transaction(async (tx) => {
      const current = await tx.select().from(gameRecords).where(affected);
      for (let i = 0; i < current.length; i += 500) {
        await tx.insert(gameRecordsArchive).values(
          current.slice(i, i + 500).map((r) => ({
            originalId: r.id,
            gameId: r.gameId,
            playerName: r.playerName,
            score: r.score,
            jumps: r.jumps,
            obstaclesDodged: r.obstaclesDodged,
            durationMs: r.durationMs,
            topSpeed: r.topSpeed,
            playedAt: new Date(r.createdAt),
            archiveBatch: batch,
          })),
        );
      }
      if (current.length > 0) {
        await tx.delete(gameRecords).where(
          inArray(
            gameRecords.id,
            current.map((r) => r.id),
          ),
        );
      }
      return current.length;
    });

    const [{ archived }] = await db
      .select({ archived: sql<number>`count(*)::int` })
      .from(gameRecordsArchive);

    return NextResponse.json({
      ok: true,
      cleared,
      archivedTotal: archived ?? 0,
      batch,
      cutoff: cutoff.toISOString(),
      message: `Leaderboard cleared. ${cleared} record(s) safely backed up to archive (${batch}).`,
    });
  } catch (err) {
    console.error("POST /api/scores/reset failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not reset leaderboard." },
      { status: 500 },
    );
  }
}

// GET /api/scores/reset — archive info (how many historical rows are safe)
export async function GET() {
  try {
    const [{ archived }] = await db
      .select({ archived: sql<number>`count(*)::int` })
      .from(gameRecordsArchive);
    const [{ live }] = await db
      .select({ live: sql<number>`count(*)::int` })
      .from(gameRecords);
    return NextResponse.json({ ok: true, live: live ?? 0, archived: archived ?? 0 });
  } catch (err) {
    console.error("GET /api/scores/reset failed:", err);
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 500 });
  }
}
