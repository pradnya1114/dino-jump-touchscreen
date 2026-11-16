import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { gameRecords } from "@/db/schema";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtTime(d: Date): string {
  return d.toISOString().slice(11, 19);
}

// GET /api/scores/export — Excel workbook with 2 sheets:
// Sheet 1 "All Records", Sheet 2 "Top 10 Leaderboard"
export async function GET(_req: NextRequest) {
  try {
    const all = await db
      .select()
      .from(gameRecords)
      .orderBy(desc(gameRecords.createdAt))
      .limit(5000);

    const top = [...all]
      .sort((a, b) => b.score - a.score || +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 10);

    const allRows = all.map((r) => ({
      "Game ID": r.gameId,
      "Record #": r.id,
      "Player Name": r.playerName,
      Score: r.score,
      Jumps: r.jumps,
      "Obstacles Dodged": r.obstaclesDodged,
      "Duration (s)": Math.round(r.durationMs / 100) / 10,
      "Top Speed": r.topSpeed,
      Date: fmtDate(new Date(r.createdAt)),
      Time: fmtTime(new Date(r.createdAt)),
    }));

    const topRows = top.map((r, i) => ({
      Rank: i + 1,
      "Player Name": r.playerName,
      Score: r.score,
      "Game ID": r.gameId,
      Date: fmtDate(new Date(r.createdAt)),
      Time: fmtTime(new Date(r.createdAt)),
    }));

    const wb = XLSX.utils.book_new();
    const wsAll = XLSX.utils.json_to_sheet(
      allRows.length > 0
        ? allRows
        : [{ "Game ID": "", "Record #": "", "Player Name": "No records yet", Score: 0, Jumps: 0, "Obstacles Dodged": 0, "Duration (s)": 0, "Top Speed": 0, Date: "", Time: "" }],
    );
    const wsTop = XLSX.utils.json_to_sheet(
      topRows.length > 0
        ? topRows
        : [{ Rank: "", "Player Name": "No records yet", Score: "", "Game ID": "", Date: "", Time: "" }],
    );
    wsAll["!cols"] = [{ wch: 38 }, { wch: 10 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
    wsTop["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 10 }, { wch: 38 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsAll, "All Records");
    XLSX.utils.book_append_sheet(wb, wsTop, "Top 10 Leaderboard");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `dino-jump-records-${stamp}.xlsx`;

    const body = new Uint8Array(buf);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(body.byteLength),
      },
    });
  } catch (err) {
    console.error("GET /api/scores/export failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not generate Excel file." },
      { status: 500 },
    );
  }
}
