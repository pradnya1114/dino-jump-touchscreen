"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/Brand";
import { DinoGame, type DinoGameHandle, type GamePhase, type GameStats } from "@/components/DinoGame";
import {
  formatScore,
  getBestScore,
  getPlayerName,
  newGameId,
  saveLastResult,
  setBestScore,
} from "@/lib/game-storage";
import { saveGame } from "@/lib/local-store";
import { useNav, useQuery } from "@/lib/nav";
import { isJumpKey } from "@/lib/serial";
import { syncNow } from "@/lib/sync";

export function PlayScreen() {
  const router = useNav();
  const params = useQuery();
  const gameRef = useRef<DinoGameHandle | null>(null);

  const queryName = (params.get("name") ?? "").trim();
  const [name, setName] = useState(() => queryName || getPlayerName().trim() || "Player");
  const [prevQueryName, setPrevQueryName] = useState(queryName);
  if (queryName && queryName !== prevQueryName) {
    setPrevQueryName(queryName);
    setName(queryName);
  }

  const [phase, setPhase] = useState<GamePhase>("ready");
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<GameStats>({ score: 0, jumps: 0, obstaclesDodged: 0, durationMs: 0, topSpeed: 0 });
  const [best, setBest] = useState(() => getBestScore());
  const [isNewBest, setIsNewBest] = useState(false);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("dinojump.muted") === "1";
    } catch {
      return false;
    }
  });
  const [jumpFlash, setJumpFlash] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const gameIdRef = useRef(newGameId());
  const playedAtRef = useRef<{ id: string; at: string } | null>(null);
  const saveAttemptedRef = useRef(false);
  const resultNavigatedRef = useRef(false);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bestRef = useRef(best);
  const phaseRef = useRef<GamePhase>("ready");
  const countdownRef = useRef<number | null>(null);

  useEffect(() => {
    bestRef.current = best;
  }, [best]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    countdownRef.current = countdown;
  }, [countdown]);

  useEffect(() => {
    return () => {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    };
  }, []);

  const toggleMute = () => {
    setMuted((m) => {
      try {
        localStorage.setItem("dinojump.muted", m ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !m;
    });
  };

  // ---- jump dispatcher (single entry for ALL inputs, no double-jump) ----
  const doJump = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const ok = gameRef.current?.jump() ?? false;
    if (ok) {
      setJumpFlash(true);
      setTimeout(() => setJumpFlash(false), 140);
    }
  }, []);

  // ---- countdown then start ----
  const beginCountdown = useCallback(() => {
    if (phaseRef.current === "running" || phaseRef.current === "over") return;
    if (countdownRef.current !== null) return;
    setCountdown(3);
  }, []);

  // ---- unified action handler (ready -> start countdown; running -> jump) ----
  const handleAction = useCallback(() => {
    if (phaseRef.current === "ready") {
      beginCountdown();
    } else if (phaseRef.current === "running") {
      doJump();
    }
  }, [beginCountdown, doJump]);

  // ---- keyboard: Space / ArrowUp / W / Enter ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isJumpKey(e)) {
        e.preventDefault();
        if (e.repeat) return;
        handleAction();
      } else if (e.code === "Enter" && phaseRef.current === "ready") {
        beginCountdown();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleAction, beginCountdown]);

  useEffect(() => {
    if (countdown === null) return;
    const t = setTimeout(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          setIsNewBest(false);
          saveAttemptedRef.current = false;
          resultNavigatedRef.current = false;
          playedAtRef.current = null;
          if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
          gameIdRef.current = newGameId();
          gameRef.current?.start();
          return null;
        }
        return c - 1;
      });
    }, 750);
    return () => clearTimeout(t);
  }, [countdown]);

  const saveAndGoToResults = useCallback(
    async (s: GameStats, wasNewBest: boolean) => {
      const gameId = gameIdRef.current;
      if (playedAtRef.current?.id !== gameId) {
        playedAtRef.current = { id: gameId, at: new Date().toISOString() };
      }
      const playedAt = playedAtRef.current.at;

      // Results page can show this run immediately, even before IndexedDB reads finish.
      saveLastResult({
        gameId,
        playerName: name,
        score: s.score,
        jumps: s.jumps,
        obstaclesDodged: s.obstaclesDodged,
        durationMs: s.durationMs,
        topSpeed: s.topSpeed,
        isNewBest: wasNewBest,
        playedAt,
      });

      const savePromise = (async () => {
        try {
          // Written to this device first — works with no connection at all.
          await saveGame({
            gameId,
            playerName: name,
            score: s.score,
            jumps: s.jumps,
            obstaclesDodged: s.obstaclesDodged,
            durationMs: s.durationMs,
            topSpeed: s.topSpeed,
            playedAt,
          });
          // Copied to the database in the background as soon as it can be reached.
          void syncNow();
        } catch (err) {
          console.error("Could not save the finished game on this device", err);
        }
      })();

      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      resultTimerRef.current = setTimeout(() => {
        router.push(
          `/results?gameId=${encodeURIComponent(gameId)}&name=${encodeURIComponent(name)}`,
        );
      }, 1400);

      // Never let a slow storage write keep the player stuck on the game screen.
      await Promise.race([
        savePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 800)),
      ]);
    },
    [name, router],
  );

  const handlePhase = useCallback(
    (p: GamePhase, s: GameStats) => {
      setPhase(p);
      setStats({ ...s });
      setScore(s.score);
      if (p === "over" && !saveAttemptedRef.current) {
        saveAttemptedRef.current = true;
        resultNavigatedRef.current = true;

        const wasNewBest = s.score > bestRef.current;
        if (wasNewBest) {
          bestRef.current = s.score;
          setBest(s.score);
          setBestScore(s.score);
        }
        setIsNewBest(wasNewBest);

        // No game-over popup: save once, then open the Results page.
        void saveAndGoToResults(s, wasNewBest);
      }
    },
    [saveAndGoToResults],
  );

  const fullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      /* ignore */
    }
  };

  const speedPct = Math.min(100, Math.round(((stats.topSpeed - 430) / (980 - 430)) * 100));

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-[#0b0620]">
      {/* backdrop */}
      <div aria-hidden className="kiosk-bg pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: "url(/images/bg-game.jpg)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0b0620]/70 via-transparent to-[#0b0620]/85" />

      {/* HUD header */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-3 pt-3 sm:px-5">
        <div className="flex items-center gap-3">
          <BrandLogo />
        </div>

        {/* scoreboard */}
        <div className="panel-arcade flex items-center gap-4 rounded-2xl px-4 py-2 sm:gap-7 sm:px-7 sm:py-3">
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300">Player</p>
            <p className="font-arcade max-w-[140px] truncate text-sm text-white sm:text-lg">{name}</p>
          </div>
          <div className="h-10 w-px bg-white/15" />
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#ffd23f]">Score</p>
            <p className="font-pixel text-xl text-[#ffd23f] title-glow sm:text-3xl">{formatScore(score)}</p>
          </div>
          <div className="h-10 w-px bg-white/15" />
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-300">Best</p>
            <p className="font-pixel text-xl text-emerald-300 sm:text-3xl">★{formatScore(Math.max(best, score))}</p>
          </div>
          {isNewBest && phase === "over" && (
            <span className="animate-pop-in rounded-full bg-[#ffd23f] px-3 py-1 font-pixel text-[10px] text-[#2b1200]">NEW!</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={toggleMute} className="rounded-xl border-2 border-white/0 bg-black/0 px-3 py-2 text-lg backdrop-blur hover:bg-black/70" title={muted ? "Unmute" : "Mute"} aria-label="Toggle sound">
            {muted ? "🔇" : ""}
          </button>
          <button onClick={fullscreen} className="rounded-xl border-2 border-white/0 bg-black/0 px-3 py-2 text-lg backdrop-blur hover:bg-black/70" title="Fullscreen" aria-label="Toggle fullscreen">
           
          </button>
          <button onClick={() => router.push("/")} className="rounded-xl border-2 border-white/0 bg-black/0 px-3 py-2 text-lg backdrop-blur hover:bg-black/70" title="Home" aria-label="Go home">
            
          </button>
        </div>
      </header>

      {/* difficulty strip */}
      <div className="relative z-20 mx-3 mt-2 flex items-center gap-3 rounded-full border border-white/15 bg-black/45 px-4 py-1.5 backdrop-blur sm:mx-5">
        <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/60">Speed</span>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-yellow-400 to-red-500 transition-all duration-500" style={{ width: `${phase === "running" ? Math.max(6, speedPct) : 4}%` }} />
        </div>
        <span className="font-pixel text-[10px] text-white/70">
          {phase === "running" ? `${stats.topSpeed} px/s` : "READY"} · 🌵 {stats.obstaclesDodged} dodged · ⬆ {stats.jumps} jumps
        </span>
      </div>

      {/* game canvas */}
      <div className="relative z-10 mx-3 mt-2 flex-1 sm:mx-5">
        <div className="relative h-[46vh] min-h-[300px] w-full overflow-hidden rounded-3xl border-4 border-[#1a0b2e] shadow-[0_24px_60px_rgba(0,0,0,0.55)] sm:h-[52vh]">
          <DinoGame
            ref={gameRef}
            muted={muted}
            onPhaseChange={handlePhase}
            onScore={(s, st) => {
              setScore(s);
              setStats({ ...st });
            }}
          />

          {/* READY overlay */}
          {phase === "ready" && countdown === null && (
            <button onClick={beginCountdown} className="absolute inset-0 z-10 grid w-full place-items-center bg-[#12082e]/45 backdrop-blur-[1px]">
              <span className="animate-pop-in panel-arcade mx-4 rounded-3xl px-8 py-6 text-center sm:px-14 sm:py-8">
                <span className="font-pixel block text-xs tracking-[0.3em] text-cyan-300">READY, {name.toUpperCase()}?</span>
                <span className="font-arcade mt-3 block text-3xl text-[#ffd23f] title-glow sm:text-5xl">TAP TO START</span>
                <span className="animate-blink-soft mt-3 block text-xs font-bold uppercase tracking-[0.3em] text-white/70">
                  
                </span>
              </span>
            </button>
          )}

          {/* countdown overlay */}
          {countdown !== null && countdown > 0 && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-[#12082e]/55">
              <div key={countdown} className="animate-countdown font-arcade text-8xl text-[#ffd23f] title-glow sm:text-9xl">
                {countdown}
              </div>
            </div>
          )}

          {/* GAME OVER overlay */}
          {phase === "over" && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-black/45 backdrop-blur-[2px]">
              <div className="animate-pop-in panel-arcade mx-4 rounded-3xl px-8 py-5 text-center sm:px-12 sm:py-7">
                <span className="font-arcade title-glow block text-4xl text-red-400 sm:text-6xl">
                  GAME OVER
                </span>
                <span className="font-pixel mt-2 block text-xs tracking-widest text-[#ffd23f] sm:text-sm">
                  SCORE: {formatScore(score)}
                </span>
                {isNewBest && (
                  <span className="mt-2 inline-block rounded-full bg-[#ffd23f] px-3 py-1 font-pixel text-[10px] text-[#2b1200]">
                    ★ NEW RECORD! ★
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* bottom jump control */}
      <div className="relative z-20 mx-3 mb-3 mt-3 flex justify-center sm:mx-5">
        {/* JUMP button */}
        <div className="flex items-center justify-center">
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              handleAction();
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`btn-jump font-arcade relative h-36 w-36 text-2xl text-[#0b2b1a] sm:h-44 sm:w-44 sm:text-3xl ${
              jumpFlash ? "jumping bg-gradient-to-b from-yellow-200 to-emerald-400" : "bg-gradient-to-b from-[#7dffb0] via-[#3ddc84] to-[#159a55]"
            }`}
            aria-label="Jump"
          >
            ⬆<br />JUMP
            {phase === "running" && <span className="absolute -bottom-7 left-1/2 w-max -translate-x-1/2 text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">or Space</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
