"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PageShell } from "@/components/Brand";
import { downloadRecordsWorkbook, warmUpExport } from "@/lib/export-excel";
import { formatScore, getBestScore, getLastResult, type LastResult } from "@/lib/game-storage";
import {
  getAllRecords,
  onDataChange,
  resetLeaderboardOnDevice,
  sortLeaderboard,
  type KioskRecord,
} from "@/lib/local-store";
import { useNav, useQuery } from "@/lib/nav";
import { syncNow, useSyncState } from "@/lib/sync";

const RANK_MEDAL = ["🥇", "🥈", "🥉"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function ResultsScreen() {
  const router = useNav();
  const params = useQuery();
  const sync = useSyncState();

  const [records, setRecords] = useState<KioskRecord[] | null>(null);
  const [storeError, setStoreError] = useState(false);
  const gameId = params.get("gameId");
  const nameParam = params.get("name");
  const last = useMemo(() => getLastResult(), []);
  const deviceBest = useMemo(() => getBestScore(), []);
  const [downloading, setDownloading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // The records come from this device (so this page works offline) and are
  // re-read whenever they change — a new game, a sync with the database, a reset.
  useEffect(() => {
    let alive = true;
    const load = () => {
      getAllRecords().then(
        (all) => {
          if (!alive) return;
          setRecords(all);
          setStoreError(false);
        },
        () => {
          if (!alive) return;
          setRecords([]);
          setStoreError(true);
        },
      );
    };
    load();
    const off = onDataChange(load);
    void syncNow(); // hand over / pick up anything the database has, if it is reachable
    warmUpExport();
    return () => {
      alive = false;
      off();
    };
  }, []);



  const live = useMemo(() => sortLeaderboard(records ?? []), [records]);
  const archivedCount = useMemo(
    () => (records ?? []).filter((r) => r.archived).length,
    [records],
  );
  const loading = records === null;
  const board = live.slice(0, 10);
  const total = live.length;

  const lastForThisGame = last && (!gameId || last.gameId === gameId) ? last : null;
  const currentId = gameId ?? lastForThisGame?.gameId ?? null;
  const mine = currentId ? ((records ?? []).find((r) => r.gameId === currentId) ?? null) : null;
  const view = {
    playerName:
      mine?.playerName ?? lastForThisGame?.playerName ?? nameParam ?? last?.playerName ?? "Player",
    score: mine?.score ?? lastForThisGame?.score ?? 0,
    jumps: mine?.jumps ?? lastForThisGame?.jumps ?? 0,
    obstaclesDodged: mine?.obstaclesDodged ?? lastForThisGame?.obstaclesDodged ?? 0,
    durationMs: mine?.durationMs ?? lastForThisGame?.durationMs ?? 0,
    isNewBest: lastForThisGame?.isNewBest ?? false,
  };
  const rankIndex = currentId ? live.findIndex((r) => r.gameId === currentId) : -1;
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const highest = Math.max(live.length > 0 ? live[0].score : 0, deviceBest, view.score);
  const offline = !sync.online || sync.serverReachable === false;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3600);
  }, []);

  // ---- KEY 1: save / download ALL data as Excel (works with no connection) ----
  const downloadExcel = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // If the database answers quickly its records are included; never wait long for it.
      await Promise.race([syncNow(), wait(2500)]);
      const info = await downloadRecordsWorkbook(await getAllRecords());
      showToast(
        `📥 Excel saved — ${plural(info.records, "record")} + Top 10${
          info.archived > 0 ? ` + ${info.archived} archived` : ""
        }`,
      );
    } catch {
      showToast("⚠️ Excel download failed — try again");
    } finally {
      setDownloading(false);
    }
  }, [downloading, showToast]);

  // ---- KEY 2: reset (opens confirmation modal) ----
  const requestReset = useCallback(() => {
    setResetMsg(null);
    setShowResetModal(true);
  }, []);

  const confirmReset = async () => {
    if (resetting) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const { cleared } = await resetLeaderboardOnDevice();
      const result = await Promise.race([syncNow(), wait(4000).then(() => null)]);
      const inDatabase = result !== null && result.ok;
      setResetMsg(
        `Leaderboard cleared. ${plural(cleared, "record")} kept as a backup on this device${
          inDatabase
            ? " and in the database archive."
            : " — the database is updated as soon as it can be reached."
        }`,
      );
      showToast("🗑️ Leaderboard reset — history backed up safely");
    } catch {
      setResetMsg("The reset could not be completed. Please try again.");
    } finally {
      setResetting(false);
    }
  };

  // keyboard shortcuts 1 / 2
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Digit1" || e.code === "Numpad1") {
        e.preventDefault();
        void downloadExcel();
      } else if (e.code === "Digit2" || e.code === "Numpad2") {
        e.preventDefault();
        if (!showResetModal) requestReset();
      } else if (e.key === "Escape") {
        setShowResetModal(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [downloadExcel, requestReset, showResetModal]);

  const status =
    rank === 1
      ? "🏆 CHAMPION — #1!"
      : rank !== null && rank <= 3
        ? `🥇 TOP 3 — Rank #${rank}`
        : rank !== null && rank <= 10
          ? `⭐ TOP 10 — Rank #${rank}`
          : rank !== null
            ? `💪 Rank #${rank} — try again for the Top 10`
            : total > 0
              ? "💪 Nice run! Try again for Top 10"
              : "🦖 Ready for the first run!";

  const syncLine = offline
    ? ""
    : sync.lastSyncAt
      ? `In step with the database · ${new Date(sync.lastSyncAt).toLocaleTimeString()}`
      : "Checking the database…";

  return (
    <PageShell bg="/images/bg-results.jpg">
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-6 sm:px-6">
        <div className="text-center">
          <h1 className="font-arcade title-glow text-3xl text-[#ffd23f] sm:text-5xl">🏁 RESULTS 🏁</h1>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.35em] text-white/70">
            {plural(total, "game")} recorded · saved on this device
          </p>
          {storeError && (
            <p className="mt-2 rounded-xl border-2 border-red-400 bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-200">
              ⚠️ This browser could not read its saved records. Reload the page.
            </p>
          )}
        </div>

        <div className="mt-4 grid w-full max-w-6xl gap-4 lg:grid-cols-[1fr_1.1fr]">
          {/* LEFT — player result */}
          <section className="panel-arcade animate-pop-in rounded-[2rem] p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Player result</p>
            <h2 className="font-arcade mt-2 truncate text-3xl text-white sm:text-4xl">
              {view.playerName}
            </h2>

            <div className="mt-4 rounded-2xl border-2 border-[#ffd23f]/50 bg-black/45 p-5 text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/60">Final score</p>
              <p className="font-pixel title-glow mt-1 text-5xl text-[#ffd23f] sm:text-6xl">
                {formatScore(view.score)}
              </p>
              <p className="mt-2 inline-block rounded-full bg-white/10 px-4 py-1.5 font-arcade text-sm text-emerald-300 ring-1 ring-emerald-300/40">
                {status}
              </p>
              {view.isNewBest && (
                <p className="animate-blink-soft mt-2 font-arcade text-sm text-[#ffd23f]">★ PERSONAL BEST ★</p>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-white/8 p-3 text-center ring-1 ring-white/15">
                <p className="font-pixel text-base text-[#ffd23f]">★{formatScore(highest)}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/55">Highest</p>
              </div>
              <div className="rounded-xl bg-white/8 p-3 text-center ring-1 ring-white/15">
                <p className="font-pixel text-base text-cyan-300">{view.jumps}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/55">Jumps</p>
              </div>
              <div className="rounded-xl bg-white/8 p-3 text-center ring-1 ring-white/15">
                <p className="font-pixel text-base text-emerald-300">{view.obstaclesDodged}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/55">Dodged</p>
              </div>
              <div className="rounded-xl bg-white/8 p-3 text-center ring-1 ring-white/15">
                <p className="font-pixel text-base text-pink-300">{(view.durationMs / 1000).toFixed(1)}s</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/55">Survived</p>
              </div>
            </div>

            <div className="mt-5 grid gap-2.5">
              <button
                onClick={() => router.push("/")}
                className="btn-arcade bg-gradient-to-b from-slate-100 to-slate-400 px-4 py-4 font-arcade text-lg text-slate-900"
              >
                🏠 HOME
              </button>
            </div>
          </section>

          {/* RIGHT — top 10 */}
          <section className="panel-arcade animate-pop-in rounded-[2rem] p-6 sm:p-8" style={{ animationDelay: "0.08s" }}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-arcade text-2xl text-[#ffd23f] sm:text-3xl">
                <span className="animate-trophy inline-block">🏆</span> TOP 10
              </h2>
              <button
                onClick={() => void syncNow()}
                className="rounded-xl border-0 border-white/0 bg-black/0 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white"
              >
                
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border-2 border-white/15">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#ffd23f]/15 text-[11px] font-bold uppercase tracking-[0.2em] text-[#ffd23f]">
                    <th className="px-3 py-2.5 sm:px-4">Rank</th>
                    <th className="px-3 py-2.5">Player</th>
                    <th className="px-3 py-2.5 text-right sm:px-4">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center font-pixel text-xs text-white/50">
                        LOADING LEADERBOARD…
                      </td>
                    </tr>
                  ) : board.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center">
                        <p className="text-4xl">🦖</p>
                        <p className="mt-2 font-arcade text-sm text-white/70">No scores yet — be the first!</p>
                      </td>
                    </tr>
                  ) : (
                    board.map((r, i) => {
                      const isMine = currentId === r.gameId;
                      return (
                        <tr
                          key={r.gameId}
                          data-game-id={r.gameId}
                          className={`lb-row border-t border-white/10 text-sm sm:text-base ${
                            isMine ? "bg-[#ffd23f]/20" : i % 2 === 0 ? "bg-white/[0.04]" : "bg-transparent"
                          }`}
                        >
                          <td className="px-3 py-2.5 font-arcade sm:px-4">
                            <span className="mr-1.5 inline-block w-7 text-center">
                              {i < 3 ? RANK_MEDAL[i] : <span className="text-white/50">#{i + 1}</span>}
                            </span>
                            <span className="font-pixel text-[11px] text-white/60">#{i + 1}</span>
                          </td>
                          <td className="max-w-[140px] truncate px-3 py-2.5 font-bold text-white sm:max-w-none">
                            {r.playerName}
                            {isMine && (
                              <span className="ml-2 rounded-full bg-[#ffd23f] px-2 py-0.5 text-[10px] font-black uppercase text-[#2b1200]">
                                You
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-pixel text-sm text-[#ffd23f] sm:px-4 sm:text-base">
                            {formatScore(r.score)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">
              <span></span>
              <span data-sync-line>{syncLine}</span>
            </div>
          </section>
        </div>
      </div>

      {/* reset confirmation modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="animate-pop-in panel-arcade w-full max-w-md rounded-3xl border-red-400/50 p-6 text-center sm:p-8">
            <p className="text-5xl">⚠️</p>
            <h3 className="font-arcade mt-3 text-2xl text-red-300">RESET LEADERBOARD?</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/80">
              This will clear <b>{plural(total, "live record")}</b> from the public Top&nbsp;10 board.
              Nothing is deleted: they are kept as a backup ({archivedCount} archived so far).
            </p>
            <div className="mt-3 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-200">
              🛡️ Safe: cleared records stay on this device, in the database archive, and in the
              Excel file (sheet &quot;Archive&quot;).
            </div>
            {resetMsg && (
              <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white">{resetMsg}</p>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => setShowResetModal(false)}
                className="btn-arcade bg-gradient-to-b from-slate-100 to-slate-400 px-4 py-3 font-arcade text-sm text-slate-900"
              >
                ✕ {resetMsg ? "CLOSE" : "CANCEL"}
              </button>
              <button
                onClick={() => void confirmReset()}
                disabled={resetting}
                className="btn-arcade bg-gradient-to-b from-[#fb7185] to-[#be123c] px-4 py-3 font-arcade text-sm text-white"
              >
                {resetting ? "WORKING…" : "✓ YES, RESET"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-white/45">
              Press <Kbd>Esc</Kbd> to cancel · records are never cleared without this confirmation
            </p>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div
          data-toast
          className="animate-pop-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border-2 border-[#ffd23f]/60 bg-black/85 px-6 py-3 font-bold text-[#ffd23f] shadow-2xl backdrop-blur"
        >
          {toast}
        </div>
      )}
    </PageShell>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-block rounded-md border border-white/30 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
      {children}
    </kbd>
  );
}
