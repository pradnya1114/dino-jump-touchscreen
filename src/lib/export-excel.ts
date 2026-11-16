"use client";

import { sortLeaderboard, type KioskRecord } from "./local-store";

// ---------------------------------------------------------------------------
// Excel export, built entirely in the browser from the records stored on this
// device — so key 1 works with no connection.
//
//   Sheet 1  "All Records"            every game on the leaderboard
//   Sheet 2  "Top 10 Leaderboard"
//   Sheet 3  "Archive (before reset)" only present once the board has been
//                                     reset: the games that were cleared
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

function dateOf(isoTime: string): string {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeOf(isoTime: string): string {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const byTime = (a: KioskRecord, b: KioskRecord) =>
  a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : 0;

export interface ExportInfo {
  fileName: string;
  records: number;
  top: number;
  archived: number;
}

/** Builds the workbook from the given records and downloads it. Dates/times are local. */
export async function downloadRecordsWorkbook(records: KioskRecord[]): Promise<ExportInfo> {
  const XLSX = await import("xlsx");

  const live = records.filter((r) => !r.archived);
  const oldestFirst = [...live].sort(byTime);
  const recordNo = new Map(oldestFirst.map((r, i) => [r.gameId, i + 1]));

  const allRows = [...oldestFirst].reverse().map((r) => ({
    "Game ID": r.gameId,
    "Record #": recordNo.get(r.gameId) ?? "",
    "Player Name": r.playerName,
    Score: r.score,
    Jumps: r.jumps,
    "Obstacles Dodged": r.obstaclesDodged,
    "Duration (s)": Math.round(r.durationMs / 100) / 10,
    "Top Speed": r.topSpeed,
    Date: dateOf(r.playedAt),
    Time: timeOf(r.playedAt),
  }));

  const topRows = sortLeaderboard(live)
    .slice(0, 10)
    .map((r, i) => ({
      Rank: i + 1,
      "Player Name": r.playerName,
      Score: r.score,
      "Game ID": r.gameId,
      Date: dateOf(r.playedAt),
      Time: timeOf(r.playedAt),
    }));

  const archiveRows = records
    .filter((r) => r.archived)
    .sort(byTime)
    .reverse()
    .map((r) => ({
      "Game ID": r.gameId,
      "Player Name": r.playerName,
      Score: r.score,
      Jumps: r.jumps,
      "Obstacles Dodged": r.obstaclesDodged,
      "Duration (s)": Math.round(r.durationMs / 100) / 10,
      "Top Speed": r.topSpeed,
      Date: dateOf(r.playedAt),
      Time: timeOf(r.playedAt),
      "Cleared On": r.archivedAt ? `${dateOf(r.archivedAt)} ${timeOf(r.archivedAt)}` : "",
    }));

  const wb = XLSX.utils.book_new();

  const wsAll = XLSX.utils.json_to_sheet(
    allRows.length > 0
      ? allRows
      : [
          {
            "Game ID": "",
            "Record #": "",
            "Player Name": "No records yet",
            Score: 0,
            Jumps: 0,
            "Obstacles Dodged": 0,
            "Duration (s)": 0,
            "Top Speed": 0,
            Date: "",
            Time: "",
          },
        ],
  );
  wsAll["!cols"] = [38, 10, 22, 10, 10, 18, 14, 12, 12, 10].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsAll, "All Records");

  const wsTop = XLSX.utils.json_to_sheet(
    topRows.length > 0
      ? topRows
      : [{ Rank: "", "Player Name": "No records yet", Score: "", "Game ID": "", Date: "", Time: "" }],
  );
  wsTop["!cols"] = [8, 24, 10, 38, 12, 10].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsTop, "Top 10 Leaderboard");

  if (archiveRows.length > 0) {
    const wsArchive = XLSX.utils.json_to_sheet(archiveRows);
    wsArchive["!cols"] = [38, 22, 10, 10, 18, 14, 12, 12, 10, 20].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, wsArchive, "Archive (before reset)");
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const fileName = `dino-jump-records-${stamp}.xlsx`;

  const data = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return { fileName, records: allRows.length, top: topRows.length, archived: archiveRows.length };
}

/** Loads the spreadsheet code ahead of time so the first key-1 press is instant, even offline. */
export function warmUpExport(): void {
  void import("xlsx").catch(() => {});
}
