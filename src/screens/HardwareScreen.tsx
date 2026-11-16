"use client";

import { useState } from "react";
import { useNav } from "@/lib/nav";
import { PageShell } from "@/components/Brand";

const ARDUINO_CODE = `/*
 * DINO JUMP — Arduino Nano + KY-023 Joystick Controller
 * USB Serial @ 9600 baud. Sends "JUMP" on stick-UP or click.
 * Wiring: GND->GND, +5V->5V, VRx->A0, VRy->A1, SW->D2
 */
const uint8_t PIN_VRX = A0;
const uint8_t PIN_VRY = A1;
const uint8_t PIN_SW  = 2;

const int TH_UP = 350, TH_NEUTRAL = 450;
const unsigned long DEBOUNCE_MS = 60, JUMP_GAP_MS = 180, TELEM_MS = 250;

bool armed = true;
int lastY = 512, lastSw = HIGH;
unsigned long lastJumpAt = 0, lastChange = 0, lastTelem = 0;

void setup() {
  pinMode(PIN_SW, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 1500) {}
  Serial.println(F("DINO-JUMP READY"));
}

void loop() {
  int x = analogRead(PIN_VRX);
  int y = analogRead(PIN_VRY);
  int sw = digitalRead(PIN_SW);
  unsigned long now = millis();

  bool wantJump = (y < TH_UP) || (sw == LOW);
  bool neutral  = (y > TH_NEUTRAL) && (sw != LOW);
  if (neutral) armed = true;

  if (wantJump != (lastY < TH_UP || lastSw == LOW)) lastChange = now;
  lastY = y; lastSw = sw;
  bool stable = (now - lastChange) >= DEBOUNCE_MS;

  if (wantJump && armed && stable && (now - lastJumpAt) >= JUMP_GAP_MS) {
    Serial.println(F("JUMP"));
    digitalWrite(LED_BUILTIN, HIGH); delay(40);
    digitalWrite(LED_BUILTIN, LOW);
    armed = false; lastJumpAt = now;
  }
  if (now - lastTelem >= TELEM_MS) {
    lastTelem = now;
    Serial.print(F("X:")); Serial.print(x);
    Serial.print(F(" Y:")); Serial.print(y);
    Serial.print(F(" S:")); Serial.println(sw == LOW ? 0 : 1);
  }
  delay(5);
}`;

const SCHEMA_SQL = `-- Every completed game = one permanent row (Top 10 is just a view!)
CREATE TABLE game_records (
  id               SERIAL PRIMARY KEY,
  game_id          VARCHAR(64)  NOT NULL UNIQUE,  -- idempotency key
  player_name      VARCHAR(80)  NOT NULL,
  score            INTEGER      NOT NULL DEFAULT 0,
  jumps            INTEGER      NOT NULL DEFAULT 0,
  obstacles_dodged INTEGER      NOT NULL DEFAULT 0,
  duration_ms      INTEGER      NOT NULL DEFAULT 0,
  top_speed        INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_game_records_score ON game_records (score DESC);

-- Secure backup: reset copies rows here BEFORE clearing
CREATE TABLE game_records_archive (
  id SERIAL PRIMARY KEY,  original_id INTEGER NOT NULL,
  game_id VARCHAR(64) NOT NULL,  player_name VARCHAR(80) NOT NULL,
  score INTEGER DEFAULT 0,  jumps INTEGER DEFAULT 0,
  obstacles_dodged INTEGER DEFAULT 0,  duration_ms INTEGER DEFAULT 0,
  top_speed INTEGER DEFAULT 0,  played_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_batch TEXT NOT NULL DEFAULT 'manual'
);`;

export function HardwareScreen() {
  const router = useNav();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <PageShell bg="/images/bg-rules.jpg">
      <div className="flex flex-1 flex-col items-center px-4 pb-10 sm:px-6">
        <div className="w-full max-w-5xl">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.45em] text-cyan-300 neon-cyan">
              🛠️ Setup & Engineering Guide
            </p>
            <h1 className="font-arcade title-glow mt-2 text-3xl text-[#ffd23f] sm:text-5xl">
              JOYSTICK + SYSTEM DOCS
            </h1>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button onClick={() => router.push("/")} className="rounded-full border border-white/25 bg-black/40 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white/75 hover:text-white">🏠 Home</button>
              <button onClick={() => router.push("/play")} className="rounded-full border border-white/25 bg-black/40 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white/75 hover:text-white">▶ Play</button>
              <button onClick={() => router.push("/results")} className="rounded-full border border-white/25 bg-black/40 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white/75 hover:text-white">🏆 Results</button>
            </div>
          </div>

          {/* 1 — wiring */}
          <section className="panel-arcade mt-6 rounded-3xl p-6 sm:p-8">
            <h2 className="font-arcade text-xl text-[#ffd23f] sm:text-2xl">1 · HARDWARE WIRING</h2>
            <p className="mt-1 text-sm text-white/70">Arduino Nano + KY-023 analog joystick + USB cable. No resistors needed.</p>
            <div className="mt-4 overflow-hidden rounded-2xl border-2 border-white/15">
              <table className="w-full text-left text-sm sm:text-base">
                <thead>
                  <tr className="bg-[#ffd23f]/15 text-xs font-bold uppercase tracking-[0.2em] text-[#ffd23f]">
                    <th className="px-4 py-3">KY-023 Joystick</th>
                    <th className="px-4 py-3 text-center">→</th>
                    <th className="px-4 py-3">Arduino Nano</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {[
                    ["GND", "GND", "Black wire"],
                    ["+5V", "5V", "Red wire"],
                    ["VRx", "A0", "X axis"],
                    ["VRy", "A1", "Y axis (UP = jump)"],
                    ["SW", "D2", "Click button (jump)"],
                  ].map(([a, b, note], i) => (
                    <tr key={a} className={`border-t border-white/10 ${i % 2 ? "" : "bg-white/[0.04]"}`}>
                      <td className="px-4 py-2.5 font-bold text-cyan-300">{a}</td>
                      <td className="px-4 py-2.5 text-center text-white/40">→</td>
                      <td className="px-4 py-2.5 font-bold text-emerald-300">{b} <span className="ml-2 font-sans text-xs font-semibold text-white/50">{note}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ol className="mt-4 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-white/80">
              <li>Power off, connect the 5 jumper wires exactly as above.</li>
              <li>Plug the Nano into the kiosk PC with a <b>data-capable</b> USB cable.</li>
              <li>Install the CH340 USB driver if Windows doesn&apos;t show a COM port.</li>
              <li>Flash the sketch below (Arduino IDE → Board: <b>Arduino Nano</b> → Processor: <b>ATmega328P (Old Bootloader)</b> if upload fails).</li>
              <li>Open the PLAY page in <b>Chrome/Edge</b> → CONNECT CONTROLLER → pick the COM port → push UP to jump!</li>
            </ol>
          </section>

          {/* 2 — arduino code */}
          <section className="panel-arcade mt-4 rounded-3xl p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-arcade text-xl text-[#ffd23f] sm:text-2xl">2 · ARDUINO SKETCH</h2>
              <div className="flex gap-2">
                <button onClick={() => void copy(ARDUINO_CODE, "ino")} className="btn-arcade bg-gradient-to-b from-[#22d3ee] to-[#0e7490] px-4 py-2 font-arcade text-xs text-[#04222b]">
                  {copied === "ino" ? "✓ COPIED!" : "📋 COPY CODE"}
                </button>
                <a href="/arduino/dino_joystick.ino" download className="btn-arcade inline-block bg-gradient-to-b from-[#3ddc84] to-[#1d9d57] px-4 py-2 font-arcade text-xs text-[#0b2b1a]">
                  ⬇ .INO FILE
                </a>
              </div>
            </div>
            <ul className="mt-2 grid gap-1.5 text-[13px] font-semibold text-white/70 sm:grid-cols-2">
              <li>✅ 9600 baud serial</li>
              <li>✅ UP (Y&lt;350) or click = jump</li>
              <li>✅ 60ms debounce + 180ms gap</li>
              <li>✅ Re-arm only at neutral</li>
            </ul>
            <pre className="nice-scroll mt-3 max-h-96 overflow-auto rounded-2xl border-2 border-black bg-[#0d1021] p-4 text-left font-mono text-[12px] leading-relaxed text-emerald-200">
              {ARDUINO_CODE}
            </pre>
          </section>

          {/* 3 — serial protocol */}
          <section className="panel-arcade mt-4 rounded-3xl p-6 sm:p-8">
            <h2 className="font-arcade text-xl text-[#ffd23f] sm:text-2xl">3 · WEB SERIAL PROTOCOL</h2>
            <div className="mt-3 grid gap-3 font-mono text-[13px] sm:grid-cols-2">
              <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4">
                <p className="font-sans text-xs font-bold uppercase tracking-widest text-emerald-300">Arduino → Browser</p>
                <p className="mt-2 text-emerald-200">JUMP\n <span className="text-white/50">— trigger jump</span></p>
                <p className="text-cyan-200">X:512 Y:511 S:1\n <span className="text-white/50">— telemetry 4×/s</span></p>
                <p className="text-white/60">DINO-JUMP READY\n <span className="text-white/50">— boot banner</span></p>
              </div>
              <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 p-4">
                <p className="font-sans text-xs font-bold uppercase tracking-widest text-cyan-300">Browser side</p>
                <p className="mt-2 text-white/80">navigator.serial.requestPort()</p>
                <p className="text-white/80">port.open({"{"} baudRate: 9600 {"}"})</p>
                <p className="text-white/80">TextDecoder + \n split → onJump()</p>
                <p className="mt-1 font-sans text-[11px] font-bold text-white/50">Game runs at 60 FPS with or without hardware.</p>
              </div>
            </div>
          </section>

          {/* 4 — database */}
          <section className="panel-arcade mt-4 rounded-3xl p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-arcade text-xl text-[#ffd23f] sm:text-2xl">4 · DATABASE SCHEMA</h2>
              <button onClick={() => void copy(SCHEMA_SQL, "sql")} className="btn-arcade bg-gradient-to-b from-slate-100 to-slate-400 px-4 py-2 font-arcade text-xs text-slate-900">
                {copied === "sql" ? "✓ COPIED!" : "📋 COPY SQL"}
              </button>
            </div>
            <p className="mt-1 text-sm text-white/70">
              Postgres (MySQL-compatible relational design) via Drizzle ORM. Credentials live only in <b>DATABASE_URL</b> on the server — the browser only talks to <b>/api/*</b>.
            </p>
            <pre className="nice-scroll mt-3 max-h-80 overflow-auto rounded-2xl border-2 border-black bg-[#0d1021] p-4 text-left font-mono text-[12px] leading-relaxed text-amber-200">
              {SCHEMA_SQL}
            </pre>
          </section>

          {/* 5 — API */}
          <section className="panel-arcade mt-4 rounded-3xl p-6 sm:p-8">
            <h2 className="font-arcade text-xl text-[#ffd23f] sm:text-2xl">5 · BACKEND API</h2>
            <div className="mt-3 space-y-2 font-mono text-[13px]">
              {[
                ["GET", "/api/health", "DB ping — kiosk monitor"],
                ["GET", "/api/scores?view=top&limit=10", "Top leaderboard, high → low"],
                ["GET", "/api/scores?view=all&limit=500", "Every record, newest first"],
                ["POST", "/api/scores  {gameId, playerName, score…}", "Save 1 game (idempotent)"],
                ["GET", "/api/scores/export", "Excel .xlsx (All Records + Top 10)"],
                ["POST", "/api/scores/reset  {confirm:'RESET'}", "Backup → archive, then clear"],
                ["GET", "/api/scores/reset", "Live + archived counts"],
                ["POST", "/api/scores/sync  {records:[…]}", "Upload games saved offline (safe to repeat)"],
                ["GET", "/api/scores/sync", "Tiny change check used by kiosks"],
                ["GET", "/api/offline", "File list for the on-device copy"],
              ].map(([m, path, note]) => (
                <div key={path} className="flex flex-col gap-1 rounded-xl border border-white/12 bg-black/35 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className={`w-fit rounded-md px-2 py-0.5 text-[11px] font-black ${m === "GET" ? "bg-cyan-400/20 text-cyan-300" : "bg-emerald-400/20 text-emerald-300"}`}>{m}</span>
                  <span className="text-white/90">{path}</span>
                  <span className="text-white/45 sm:ml-auto">— {note}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 6 — offline */}
          <section className="panel-arcade mt-4 rounded-3xl p-6 sm:p-8">
            <h2 className="font-arcade text-xl text-[#ffd23f] sm:text-2xl">6 · OFFLINE MODE</h2>
            <p className="mt-1 text-sm text-white/70">
              The kiosk keeps a full copy of itself and of every record on the device, so the whole
              player journey works with no connection.
            </p>
            <div className="mt-3 grid gap-3 text-sm leading-relaxed text-white/80 md:grid-cols-2">
              <div className="rounded-2xl border border-white/12 bg-black/30 p-4">
                <p className="font-arcade text-sm text-emerald-300">📴 GETTING READY</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Open the kiosk once <b>while connected</b>.</li>
                  <li>Wait for <b>OFFLINE-READY ✓</b> in the top-right badge.</li>
                  <li>From then on it opens and runs without internet.</li>
                  <li>Always use the same browser profile — not Incognito or Guest.</li>
                </ol>
              </div>
              <div className="rounded-2xl border border-white/12 bg-black/30 p-4">
                <p className="font-arcade text-sm text-cyan-300">💾 WHERE THE DATA GOES</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Every finished game is saved <b>on the device first</b>.</li>
                  <li>It is copied to the database as soon as it can be reached — the badge shows how many are still waiting.</li>
                  <li>The leaderboard, <b>1</b> (Excel) and <b>2</b> (reset) all work offline.</li>
                  <li>Records still waiting exist only in this browser: don&apos;t clear its site data, and press <b>1</b> to keep an Excel copy.</li>
                </ul>
              </div>
            </div>
          </section>

          {/* 7 — install */}
          <section className="panel-arcade mt-4 rounded-3xl p-6 sm:p-8">
            <h2 className="font-arcade text-xl text-[#ffd23f] sm:text-2xl">7 · INSTALL & DEPLOY</h2>
            <div className="mt-3 grid gap-3 text-sm leading-relaxed text-white/80 md:grid-cols-2">
              <div className="rounded-2xl border border-white/12 bg-black/30 p-4">
                <p className="font-arcade text-sm text-cyan-300">🖥️ KIOSK (Windows + touchscreen)</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li><b>npm install</b> then set <b>DATABASE_URL</b> in .env</li>
                  <li><b>npx drizzle-kit push</b> to create tables</li>
                  <li><b>npm run build && npm start</b></li>
                  <li>Open <b>Chrome/Edge</b> fullscreen (F11) at the kiosk URL</li>
                  <li>Flash Nano, plug USB, CONNECT CONTROLLER</li>
                  <li>Staff: press <b>1</b> = Excel backup, <b>2</b> = reset board</li>
                </ol>
              </div>
              <div className="rounded-2xl border border-white/12 bg-black/30 p-4">
                <p className="font-arcade text-sm text-emerald-300">☁️ VERCEL DEPLOY</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Push repo to GitHub → Import in Vercel</li>
                  <li>Add Postgres (Vercel/Neon/Supabase) → copy <b>DATABASE_URL</b></li>
                  <li>Set env var in Vercel → Deploy</li>
                  <li>Run <b>drizzle-kit push</b> against prod DB once</li>
                  <li>HTTPS is automatic (required for Web Serial)</li>
                </ol>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
