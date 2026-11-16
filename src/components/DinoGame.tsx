"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  DINO_COLOR,
  DINO_FEET_ROW,
  DINO_FRAMES,
  DINO_H,
  DINO_HITBOXES,
  DINO_HIT_MIN_X,
  DINO_OUTLINE_COLOR,
  type DinoFrameName,
} from "@/lib/dino-sprite";

export type GamePhase = "ready" | "running" | "over";

export interface GameStats {
  score: number;
  jumps: number;
  obstaclesDodged: number;
  durationMs: number;
  topSpeed: number;
}

export interface DinoGameHandle {
  start: () => void;
  reset: () => void;
  jump: () => boolean;
  getPhase: () => GamePhase;
  getStats: () => GameStats;
}

interface Props {
  onPhaseChange?: (phase: GamePhase, stats: GameStats) => void;
  onScore?: (score: number, stats: GameStats) => void;
  onJump?: (stats: GameStats) => void;
  muted?: boolean;
}

interface Obstacle {
  x: number;
  w: number;
  h: number;
  kind: "small" | "tall" | "cluster" | "bird";
  dodged: boolean;
  flap: number;
  yOff: number;
  seed: number;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
  v: number;
}

const DIFFICULTY_START_SECONDS = 10;
const DIFFICULTY_RAMP_SECONDS = 45;
const SPEED_RAMP_PER_SECOND = 14;
const MAX_GAME_SPEED = 1080;

function getDifficulty(elapsed: number): number {
  return Math.min(1, Math.max(0, (elapsed - DIFFICULTY_START_SECONDS) / DIFFICULTY_RAMP_SECONDS));
}

// Tiny arcade beeps via WebAudio (jump / point / hit)
function makeBeep(muted: () => boolean) {
  let ctx: AudioContext | null = null;
  const ensure = () => {
    if (muted()) return null;
    try {
      if (!ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
      }
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  };
  const tone = (freq: number, dur: number, type: OscillatorType, vol = 0.12, slide = 0) => {
    const ac = ensure();
    if (!ac) return;
    try {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slide !== 0) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ac.currentTime + dur);
      g.gain.setValueAtTime(vol, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur);
    } catch {
      /* ignore */
    }
  };
  return {
    jump: () => tone(320, 0.16, "square", 0.07, 340),
    point: () => tone(880, 0.09, "sine", 0.08, 220),
    hit: () => tone(160, 0.35, "sawtooth", 0.1, -110),
    go: () => tone(660, 0.2, "square", 0.08, 440),
  };
}

export const DinoGame = forwardRef<DinoGameHandle, Props>(function DinoGame(
  { onPhaseChange, onScore, onJump, muted = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const phaseRef = useRef<GamePhase>("ready");
  const statsRef = useRef<GameStats>({ score: 0, jumps: 0, obstaclesDodged: 0, durationMs: 0, topSpeed: 0 });
  const cbRef = useRef({ onPhaseChange, onScore, onJump });
  cbRef.current = { onPhaseChange, onScore, onJump };
  const beepRef = useRef(makeBeep(() => mutedRef.current));

  // mutable world state (no react re-render per frame)
  const world = useRef({
    W: 960,
    H: 480,
    dpr: 1,
    groundY: 400,
    dinoX: 90,
    cellDev: 2, // device pixels per dino sprite cell (always a whole number)
    cell: 2, // the same size in CSS pixels
    dinoY: 0, // offset above ground (0 = on ground)
    vy: 0,
    grounded: true,
    legT: 0,
    speed: 430,
    baseSpeed: 430,
    elapsed: 0,
    dist: 0,
    groundOff: 0,
    obstacles: [] as Obstacle[],
    clouds: [] as Cloud[],
    spawnIn: 500,
    flash: 0,
    lastTs: 0,
    raf: 0,
    milestone: 0,
  });

  const emitPhase = useCallback((p: GamePhase) => {
    phaseRef.current = p;
    cbRef.current.onPhaseChange?.(p, { ...statsRef.current });
  }, []);

  const resetWorld = useCallback(() => {
    const w = world.current;
    w.dinoY = 0;
    w.vy = 0;
    w.grounded = true;
    w.legT = 0;
    w.speed = w.baseSpeed;
    w.elapsed = 0;
    w.dist = 0;
    w.groundOff = 0;
    w.obstacles = [];
    w.spawnIn = 620;
    w.flash = 0;
    w.milestone = 0;
    if (w.clouds.length === 0) {
      w.clouds = Array.from({ length: 6 }, () => ({
        x: Math.random() * w.W,
        y: 30 + Math.random() * 150,
        s: 0.6 + Math.random() * 0.9,
        v: 12 + Math.random() * 22,
      }));
    }
    statsRef.current = { score: 0, jumps: 0, obstaclesDodged: 0, durationMs: 0, topSpeed: Math.round(w.baseSpeed) };
  }, []);

  const start = useCallback(() => {
    resetWorld();
    beepRef.current.go();
    emitPhase("running");
  }, [emitPhase, resetWorld]);

  const reset = useCallback(() => {
    resetWorld();
    emitPhase("ready");
  }, [emitPhase, resetWorld]);

  const jump = useCallback((): boolean => {
    const w = world.current;
    if (phaseRef.current !== "running") return false;
    if (!w.grounded) return false; // prevent continuous / double jumping
    w.vy = -1180;
    w.grounded = false;
    statsRef.current.jumps += 1;
    beepRef.current.jump();
    cbRef.current.onJump?.({ ...statsRef.current });
    return true;
  }, []);

  const getPhase = useCallback(() => phaseRef.current, []);
  const getStats = useCallback(() => ({ ...statsRef.current }), []);

  useImperativeHandle(ref, () => ({ start, reset, jump, getPhase, getStats }), [start, reset, jump, getPhase, getStats]);

  // ---- sizing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(320, Math.floor(rect.width));
      const H = Math.max(260, Math.floor(rect.height));
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const w = world.current;
      w.W = W;
      w.H = H;
      w.dpr = dpr;
      w.groundY = H - Math.max(64, Math.min(120, H * 0.22));
      w.dinoX = Math.max(64, Math.min(150, W * 0.11));
      // The dino is pixel art: give every sprite cell a whole number of device
      // pixels so it stays perfectly sharp at any screen size / zoom level.
      const s = Math.max(0.85, Math.min(1.3, H / 480));
      let cellDev = Math.max(1, Math.round((74 * s * dpr) / DINO_FEET_ROW));
      while ((cellDev * DINO_FEET_ROW) / dpr < 52) cellDev += 1;
      w.cellDev = cellDev;
      w.cell = cellDev / dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("orientationchange", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", resize);
    };
  }, []);

  // ---- main loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = world.current;
    resetWorld();

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const spawnObstacle = () => {
      const diff = getDifficulty(w.elapsed);
      const roll = Math.random();
      let kind: Obstacle["kind"] = "small";
      if (w.elapsed > 22 && roll > 0.86) kind = "bird";
      else if (roll > 0.72) kind = "cluster";
      else if (roll > 0.45) kind = "tall";
      const scale = Math.max(0.85, Math.min(1.25, w.H / 480));
      let obW = 34 * scale;
      let obH = 62 * scale;
      if (kind === "tall") {
        obW = 36 * scale;
        obH = 88 * scale;
      } else if (kind === "cluster") {
        obW = (diff > 0.35 && Math.random() > 0.5 ? 96 : 68) * scale;
        obH = 64 * scale;
      } else if (kind === "bird") {
        obW = 52 * scale;
        obH = 34 * scale;
      }
      const yOff = kind === "bird" ? rand(55, 130) * scale + (diff > 0.5 ? rand(0, 40) : 0) : 0;
      const seed = Math.floor(Math.random() * 100);
      w.obstacles.push({ x: w.W + 60, w: obW, h: obH, kind, dodged: false, flap: Math.random() * 10, yOff, seed });
      // gap shrinks with difficulty but stays fair at high speed
      const minGap = 300 + w.speed * 0.42;
      const maxGap = 640 + w.speed * 0.75 - diff * 300;
      w.spawnIn = rand(Math.max(300, minGap), Math.max(minGap + 120, maxGap));
    };

    const step = (dt: number) => {
      w.elapsed += dt;
      const rampTime = Math.max(0, w.elapsed - DIFFICULTY_START_SECONDS);
      const target = Math.min(MAX_GAME_SPEED, w.baseSpeed + rampTime * SPEED_RAMP_PER_SECOND);
      w.speed += (target - w.speed) * Math.min(1, dt * 1.5);
      const st = statsRef.current;
      st.topSpeed = Math.max(st.topSpeed, Math.round(w.speed));

      // physics
      if (!w.grounded) {
        w.vy += 3350 * dt;
        w.dinoY -= w.vy * dt;
        if (w.dinoY <= 0) {
          w.dinoY = 0;
          w.vy = 0;
          w.grounded = true;
        }
      } else {
        // run cycle: the legs swap 10x per second, rising to 15x at top speed
        w.legT += dt * (10 + ((w.speed - w.baseSpeed) / 550) * 5);
      }

      // distance + score: 1 point per ~9px travelled, +25 per dodged obstacle
      w.dist += w.speed * dt;
      st.durationMs = Math.floor(w.elapsed * 1000);
      const newScore = Math.floor(w.dist / 9) + st.obstaclesDodged * 25;
      if (newScore !== st.score) {
        st.score = newScore;
        cbRef.current.onScore?.(st.score, { ...st });
        const m = Math.floor(st.score / 100);
        if (m > w.milestone) {
          w.milestone = m;
          beepRef.current.point();
          w.flash = 0.25;
        }
      }

      w.groundOff = (w.groundOff + w.speed * dt) % 96;
      if (w.flash > 0) w.flash -= dt;

      // clouds drift
      for (const c of w.clouds) {
        c.x -= (c.v + w.speed * 0.06) * dt;
        if (c.x < -90) {
          c.x = w.W + rand(20, 220);
          c.y = 24 + Math.random() * (w.H * 0.35);
        }
      }

      // dino sprite position (top-left of its 44 x 47 cell grid, CSS px)
      const cell = w.cell;
      const dinoLeft = w.dinoX;
      const dinoTop = w.groundY - w.dinoY - DINO_FEET_ROW * cell;
      const dodgeX = dinoLeft + DINO_HIT_MIN_X * cell;

      // spawn + move obstacles
      w.spawnIn -= w.speed * dt;
      if (w.spawnIn <= 0) spawnObstacle();
      for (const ob of w.obstacles) {
        ob.x -= w.speed * dt;
        ob.flap += dt * (ob.kind === "bird" ? 14 : 3);
        if (!ob.dodged && ob.x + ob.w < dodgeX) {
          ob.dodged = true;
          st.obstaclesDodged += 1;
          st.score += 25;
          cbRef.current.onScore?.(st.score, { ...st });
        }
      }
      w.obstacles = w.obstacles.filter((o) => o.x + o.w > -80);

      // collisions: each dino body box vs. the (slightly shrunk) obstacle box
      let crashed = false;
      for (const ob of w.obstacles) {
        const oy = ob.kind === "bird" ? w.groundY - ob.h - ob.yOff : w.groundY - ob.h;
        const shrink = ob.kind === "bird" ? 0.22 : 0.18;
        const ox = ob.x + ob.w * shrink;
        const ow = ob.w * (1 - shrink * 2);
        const oh = ob.h * (1 - shrink);
        const oyAdj = oy + ob.h * shrink * 0.5;
        for (const [hx, hy, hw, hh] of DINO_HITBOXES) {
          const bx = dinoLeft + hx * cell;
          const by = dinoTop + hy * cell;
          if (bx < ox + ow && bx + hw * cell > ox && by < oyAdj + oh && by + hh * cell > oyAdj) {
            crashed = true;
            break;
          }
        }
        if (crashed) break;
      }
      if (crashed) {
        beepRef.current.hit();
        emitPhase("over");
      }
    };

    // ---------- drawing ----------
    const drawCactus = (
      x: number,
      y: number,
      cw: number,
      ch: number,
      kind: Obstacle["kind"],
      seed: number,
    ) => {
      const u = ch / 64;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = "#1d7a4c";
      ctx.strokeStyle = "#0d3a24";
      ctx.lineWidth = 3;
      const arm = (ax: number, ay: number, aw: number, ah: number) => {
        ctx.beginPath();
        ctx.roundRect(ax, ay, aw, ah, 8 * u);
        ctx.fill();
        ctx.stroke();
      };
      if (kind === "cluster") {
        const count = cw > 75 ? 3 : 2;
        const w1 = cw / count;
        for (let i = 0; i < count; i++) {
          const cx = i * w1 + w1 * 0.15;
          const heightRatio =
            count === 3
              ? (i === 1 ? 1 : 0.74 + ((seed + i) % 3) * 0.08)
              : (i === 0 ? 0.85 : 1);
          const chh = ch * heightRatio;
          arm(cx, ch - chh, w1 * 0.65, chh);
          if (i === 0) {
            arm(cx - w1 * 0.35, ch - chh * 0.65, w1 * 0.35, chh * 0.38);
          }
          if (i === count - 1) {
            arm(cx + w1 * 0.65, ch - chh * 0.55, w1 * 0.35, chh * 0.34);
          }
        }
      } else {
        arm(cw * 0.3, 0, cw * 0.4, ch);
        arm(0, ch * 0.35, cw * 0.26, ch * 0.4);
        arm(cw * 0.74, ch * (seed % 2 === 0 ? 0.24 : 0.45), cw * 0.26, ch * 0.36);
        // spikes
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const sy = 10 + i * ((ch - 20) / 4);
          ctx.beginPath();
          ctx.moveTo(cw * 0.42, sy);
          ctx.lineTo(cw * 0.58, sy);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const drawBird = (x: number, y: number, bw: number, bh: number, flap: number) => {
      ctx.save();
      // Pterodactyl moves left towards player dino, so flip horizontally to face left
      ctx.translate(x + bw, y);
      ctx.scale(-1, 1);
      const wing = Math.sin(flap) * bh * 0.45;
      // body
      ctx.fillStyle = "#e63d5f";
      ctx.strokeStyle = "#5c0f22";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(0, bh * 0.25, bw, bh * 0.5, bh * 0.25);
      ctx.fill();
      ctx.stroke();
      // head + beak
      ctx.beginPath();
      ctx.arc(bw * 0.82, bh * 0.32, bh * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = "#ff5c7a";
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.moveTo(bw * 1.02, bh * 0.26);
      ctx.lineTo(bw * 1.22, bh * 0.36);
      ctx.lineTo(bw * 1.02, bh * 0.46);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(bw * 0.86, bh * 0.26, bh * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#12082e";
      ctx.beginPath();
      ctx.arc(bw * 0.88, bh * 0.26, bh * 0.05, 0, Math.PI * 2);
      ctx.fill();
      // wing
      ctx.fillStyle = "#a4163a";
      ctx.beginPath();
      ctx.ellipse(bw * 0.4, bh * 0.4 + wing, bw * 0.26, bh * 0.16, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // The pixel T-Rex (see src/lib/dino-sprite.ts for the artwork).
    const drawDino = () => {
      const gy = w.groundY;
      const cd = w.cellDev;
      const phase = phaseRef.current;

      // soft ground shadow — shrinks and fades while the dino is in the air
      const lift = Math.min(1, w.dinoY / 220);
      ctx.fillStyle = `rgba(58,42,18,${0.3 - lift * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(w.dinoX + 18.5 * w.cell, gy + 7, (15 - lift * 6) * w.cell, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // pick the animation frame
      let name: DinoFrameName = "stand";
      if (phase === "over") name = "dead";
      else if (phase === "running") {
        // legs alternate while running; both legs down while jumping
        if (w.grounded) name = Math.floor(w.legT) % 2 === 0 ? "run1" : "run2";
      } else if (performance.now() % 3600 < 150) name = "blink"; // idle blink before the start
      const frame = DINO_FRAMES[name];

      // Draw in raw device pixels so every sprite cell is a whole pixel block.
      const px = Math.round(w.dinoX * w.dpr);
      const py = Math.round((gy - w.dinoY) * w.dpr) - DINO_FEET_ROW * cd;
      // On the ground, the white outline below the feet is left out so the
      // dino stands right on the ground line; in the air it is outlined all round.
      const lastRow = w.grounded ? DINO_FEET_ROW : DINO_H;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = DINO_OUTLINE_COLOR;
      for (const [rx, ry, rw, rh] of frame.white) {
        const h = Math.min(rh, lastRow - ry);
        if (h > 0) ctx.fillRect(px + rx * cd, py + ry * cd, rw * cd, h * cd);
      }
      ctx.fillStyle = DINO_COLOR;
      for (const [rx, ry, rw, rh] of frame.body) {
        ctx.fillRect(px + rx * cd, py + ry * cd, rw * cd, rh * cd);
      }
      ctx.restore();
    };

    const render = () => {
      const dpr = w.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // sky
      const sky = ctx.createLinearGradient(0, 0, 0, w.H);
      sky.addColorStop(0, "#8fd8ff");
      sky.addColorStop(0.55, "#cdeffb");
      sky.addColorStop(0.78, "#fdf3d8");
      sky.addColorStop(1, "#f7e3b0");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w.W, w.H);

      // sun
      ctx.save();
      ctx.fillStyle = "rgba(255,210,63,0.9)";
      ctx.beginPath();
      ctx.arc(w.W - 90, 74, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,210,63,0.25)";
      ctx.beginPath();
      ctx.arc(w.W - 90, 74, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // distant mesas
      ctx.fillStyle = "#c9a6d8";
      ctx.globalAlpha = 0.55;
      const mesa = (mx: number, mw: number, mh: number) => {
        ctx.beginPath();
        ctx.roundRect(mx, w.groundY - mh, mw, mh, 14);
        ctx.fill();
        ctx.fillRect(mx - 10, w.groundY - mh - 14, mw + 20, 18);
      };
      const mesaData = [
        { offset: 80, w: 180, h: 120 },
        { offset: 520, w: 140, h: 88 },
        { offset: 940, w: 160, h: 104 },
      ];
      const period = Math.max(w.W + 500, 1400);
      const parallax = (w.dist * 0.08) % period;
      for (const m of mesaData) {
        let mx = m.offset - parallax;
        while (mx < -m.w - 40) mx += period;
        while (mx > w.W + period - m.w) mx -= period;
        if (mx < w.W + 40 && mx + m.w > -40) {
          mesa(mx, m.w, m.h);
        }
      }
      ctx.globalAlpha = 1;

      // clouds
      for (const c of w.clouds) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(c.s, c.s);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.arc(22, -8, 24, 0, Math.PI * 2);
        ctx.arc(48, 0, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ground
      const gy = w.groundY;
      ctx.fillStyle = "#e8b96a";
      ctx.fillRect(0, gy, w.W, w.H - gy);
      ctx.fillStyle = "#c98f3d";
      ctx.fillRect(0, gy, w.W, 6);
      ctx.fillStyle = "#a86f24";
      // scrolling pebbles / dashes
      for (let x = -w.groundOff; x < w.W + 48; x += 48) {
        ctx.fillRect(x, gy + 22, 22, 5);
        ctx.fillRect(x + 26, gy + 44, 14, 4);
      }
      // grass tufts
      ctx.strokeStyle = "#4d8a3f";
      ctx.lineWidth = 3;
      for (let x = -w.groundOff; x < w.W + 60; x += 96) {
        ctx.beginPath();
        ctx.moveTo(x + 10, gy + 2);
        ctx.lineTo(x + 14, gy - 8);
        ctx.moveTo(x + 16, gy + 2);
        ctx.lineTo(x + 20, gy - 10);
        ctx.stroke();
      }

      // obstacles
      for (const ob of w.obstacles) {
        const oy = ob.kind === "bird" ? gy - ob.h - ob.yOff : gy - ob.h;
        // shadow
        ctx.fillStyle = "rgba(58,42,18,0.25)";
        ctx.beginPath();
        ctx.ellipse(ob.x + ob.w / 2, gy + 8, ob.w * 0.42, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        if (ob.kind === "bird") drawBird(ob.x, oy, ob.w, ob.h, ob.flap);
        else drawCactus(ob.x, oy, ob.w, ob.h, ob.kind, ob.seed);
      }

      // dino
      drawDino();

      // milestone flash
      if (w.flash > 0) {
        ctx.fillStyle = `rgba(255,210,63,${Math.min(0.28, w.flash)})`;
        ctx.fillRect(0, 0, w.W, w.H);
      }

      // ready overlay hint drawn on canvas
      if (phaseRef.current === "ready") {
        ctx.fillStyle = "rgba(18,8,46,0.35)";
        ctx.fillRect(0, 0, w.W, w.H);
      }
    };

    let last = performance.now();
    const loop = (ts: number) => {
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      if (phaseRef.current === "running") step(dt);
      render();
      w.raf = requestAnimationFrame(loop);
    };
    w.raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(w.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="game-canvas block" />
    </div>
  );
});
