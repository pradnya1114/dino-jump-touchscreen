"use client";

import { useEffect, useState } from "react";
import { useNav } from "@/lib/nav";
import { PageShell } from "@/components/Brand";
import { AnimatedDino, CactusDeco } from "@/components/AnimatedDino";
import { clearPlayerName, setPlayerName } from "@/lib/game-storage";

export function WelcomeScreen() {
  const router = useNav();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);

  useEffect(() => clearPlayerName(), []);

  const start = () => {
    const clean = name.trim();
    if (!clean) {
      setError("Please enter your name to play!");
      setShake((s) => s + 1);
      return;
    }
    if (clean.length < 2) {
      setError("Name must be at least 2 characters.");
      setShake((s) => s + 1);
      return;
    }
    setError("");
    setPlayerName(clean);
    router.push(`/rules?name=${encodeURIComponent(clean)}`);
  };

  return (
    <PageShell bg="/images/bg-welcome.jpg">
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-6 sm:px-8">
        {/* marquee */}
        
          

        <div className="grid w-full max-w-6xl items-center gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* left: title + form */}
          <div className="panel-arcade animate-pop-in rounded-[2rem] p-6 text-center sm:p-10">
            <p className="text-xs font-bold uppercase tracking-[0.45em] text-cyan-300 neon-cyan sm:text-sm">
              ★ ★ ★ ★
            </p>
            <h1 className="font-arcade title-glow mt-3 text-5xl leading-none text-[#ffd23f] sm:text-7xl">
              DINO
              <br />
              <span className="text-[#3ddc84]">JUMP</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-base text-white/85 sm:text-lg">
              
            </p>

            <div className="mx-auto mt-7 max-w-md">
              <label
                htmlFor="playerName"
                className="mb-2 block text-left text-sm font-bold uppercase tracking-[0.25em] text-white/80"
              >
                Player name
              </label>
              <input
                id="playerName"
                type="text"
                value={name}
                maxLength={24}
                autoComplete="off"
                autoFocus
                placeholder="Enter your name…"
                // Select all text on focus so a new player can immediately type their name
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") start();
                }}
                key={shake}
                className={`w-full rounded-2xl border-4 bg-white/95 px-5 py-4 text-center text-2xl font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none ${error ? "border-red-500" : "border-[#1a0b2e] focus:border-[#3ddc84]"
                  } ${error ? "animate-pop-in" : ""}`}
              />
              {name && (
                <button
                  type="button"
                  onClick={() => { setName(""); setError(""); }}
                  className="mt-1 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-white/80"
                >
                  ✕ Clear name (new player)
                </button>
              )}
              {error && (
                <p className="animate-pop-in mt-2 rounded-xl border-2 border-red-400 bg-red-500/20 px-3 py-2 text-sm font-bold text-red-200">
                  ⚠️ {error}
                </p>
              )}

              <button
                onClick={start}
                className="btn-arcade shine relative mt-5 w-full overflow-hidden bg-gradient-to-b from-[#3ddc84] to-[#1d9d57] px-8 py-5 font-arcade text-2xl tracking-wide text-[#0b2b1a] sm:text-3xl"
              >
                ▶ START GAME
              </button>
              <p className="animate-blink-soft mt-3 text-xs font-bold uppercase tracking-[0.3em] text-white/60">
               
              </p>
            </div>
          </div>

          {/* right: animated dino scene */}
          <div className="relative flex flex-col items-center">
            <AnimatedDino size={240} />
            <div className="ground-strip -mt-2 h-8 w-full max-w-md rounded-full border-2 border-white/15" />
            <div className="mt-4 flex items-end justify-center gap-6">
              <CactusDeco className="h-24 w-auto drop-shadow-[0_10px_16px_rgba(0,0,0,0.5)]" />
              
              <CactusDeco className="h-16 w-auto -scale-x-100 opacity-80 drop-shadow-[0_10px_16px_rgba(0,0,0,0.5)]" />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-widest">
              
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
