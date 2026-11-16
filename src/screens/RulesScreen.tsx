"use client";

import { Suspense, useEffect, useState } from "react";
import { useNav, useQuery } from "@/lib/nav";
import { PageShell } from "@/components/Brand";
import { AnimatedDino } from "@/components/AnimatedDino";
import { getPlayerName } from "@/lib/game-storage";

const RULES = [
  { icon: "📝", title: "Enter your name", text: "Type your player name before playing so your score lands on the leaderboard." },
  { icon: "⬆️", title: "Press jump to leap", text: "Tap JUMP, hit SPACEBAR, or push the Arduino joystick UP / press its button." },
  { icon: "🌵", title: "Avoid all obstacles", text: "Dodge every cactus (and speedy pterodactyls later on). One hit ends the run!" },
  { icon: "⭐", title: "Score for every dodge", text: "Each cleanly avoided obstacle boosts your score. Milestones flash + beep!" },
  { icon: "💥", title: "Hit = game over", text: "The run ends the instant your dino touches an obstacle. No extra lives!" },
  { icon: "🏆", title: "Chase the highest score", text: "Speed keeps rising. Land in the TOP 10 and take home arcade glory!" },
];

function RulesInner() {
  const router = useNav();
  const params = useQuery();
  const queryName = (params.get("name") ?? getPlayerName() ?? "").trim();
  const [name, setName] = useState(() => queryName);
  const [prevQueryName, setPrevQueryName] = useState(queryName);
  if (queryName && queryName !== prevQueryName) {
    setPrevQueryName(queryName);
    setName(queryName);
  }
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!queryName) {
      router.replace("/");
    }
  }, [queryName, router]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      router.push(`/play?name=${encodeURIComponent(name)}`);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, name, router]);

  return (
    <PageShell bg="/images/bg-rules.jpg">
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8 sm:px-8">
        <div className="w-full max-w-6xl">
          <div className="text-center">
            <p className="text-xl font-bold uppercase tracking-[0.45em] text-pink-300 neon-pink">
              Hello, {name || "Player"}!
            </p>
            <h1 className="font-arcade title-glow mt-2 text-4xl text-[#ffd23f] sm:text-6xl">
              GAME RULES
            </h1>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {RULES.map((r, i) => (
              <div
                key={r.title}
                className="panel-arcade animate-pop-in rounded-3xl p-5"
                style={{ animationDelay: `${i * 0.07}s` }}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border-2 border-[#ffd23f]/60 bg-black/50 text-2xl">
                    {r.icon}
                  </span>
                  <h2 className="font-arcade text-sm leading-tight text-[#ffd23f] sm:text-base">
                    <span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-[#ffd23f] font-pixel text-[11px] text-[#1a0b2e]">
                      {i + 1}
                    </span>
                    {r.title}
                  </h2>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-white/85 sm:text-[15px]">{r.text}</p>
              </div>
            ))}
          </div>

          {/* controls cheat-sheet */}
          

          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              onClick={() => setCountdown(3)}
              disabled={countdown !== null}
              className="btn-arcade shine relative w-full max-w-xl overflow-hidden bg-gradient-to-b from-[#ffd23f] to-[#ff6b1a] px-8 py-5 font-arcade text-2xl tracking-wide text-[#2b1200] sm:text-3xl"
            >
              {countdown === null ? "▶ START PLAYING" : "GET READY…"}
            </button>
            <button
              onClick={() => router.push("/")}
              className="rounded-full px-6 py-2 text-sm font-bold uppercase tracking-[0.25em] text-white/60 underline-offset-4 hover:text-white hover:underline"
            >
              ← Change name
            </button>
          </div>
        </div>
      </div>

      {/* countdown overlay */}
      {countdown !== null && countdown > 0 && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center">
            <AnimatedDino size={140} />
            <div key={countdown} className="animate-countdown font-arcade text-[7rem] text-[#ffd23f] title-glow sm:text-[10rem]">
              {countdown}
            </div>
            <p className="font-pixel text-xs tracking-widest text-cyan-300">GET READY…</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}

export function RulesScreen() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-[#0b0620] font-pixel text-sm text-[#ffd23f]">LOADING…</div>}>
      <RulesInner />
    </Suspense>
  );
}
