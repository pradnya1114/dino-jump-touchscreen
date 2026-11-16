"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Arduino Nano + KY-023 joystick over the Web Serial API.
//
// The connection is owned by this module, not by a screen: once the controller
// is connected it stays connected while players move between the screens. After
// a page reload, or when the cable is plugged back in, it reconnects by itself
// (the browser remembers the port the operator allowed).
//
// Arduino sends newline-delimited text at 9600 baud:
//   "JUMP"            -> trigger a jump (button press or stick pushed up)
//   "X:512 Y:511 S:1" -> periodic telemetry
// The game works fine without hardware; this is purely additive.
// ---------------------------------------------------------------------------

export interface JoystickTelemetry {
  x: number;
  y: number;
  sw: number;
  raw: string;
  at: number;
}

export type SerialStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// Minimal Web Serial typings (Chrome / Edge on desktop).
interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
  addEventListener?: (type: "connect" | "disconnect", listener: () => void) => void;
}

declare global {
  interface Navigator {
    serial?: SerialLike;
  }
}

export function isSerialSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.serial !== "undefined";
}

export interface SerialController {
  status: SerialStatus;
  telemetry: JoystickTelemetry | null;
  jumpCount: number;
  error: string | null;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
}

interface JoystickState {
  status: SerialStatus;
  telemetry: JoystickTelemetry | null;
  jumpCount: number;
  error: string | null;
}

const BAUD_RATE = 9600;
const INITIAL: JoystickState = { status: "disconnected", telemetry: null, jumpCount: 0, error: null };

let state: JoystickState = INITIAL;
const stateListeners = new Set<() => void>();
const jumpListeners = new Set<() => void>();

let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let readLoopDone: Promise<void> | null = null;
let connected = false;
let session = 0; // bumped on every connect / disconnect so an old read loop knows to stop
let initialised = false;

function setState(patch: Partial<JoystickState>) {
  state = { ...state, ...patch };
  stateListeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function handleLine(line: string) {
  const clean = line.trim().toUpperCase();
  if (!clean) return;
  if (clean === "JUMP" || clean === "BTN" || clean === "UP") {
    setState({ jumpCount: state.jumpCount + 1 });
    jumpListeners.forEach((l) => l());
    return;
  }
  // Telemetry like "X:512 Y:511 S:1" or "512,511,1"
  const m =
    /X\s*[:=]\s*(-?\d+)[,\s]+Y\s*[:=]\s*(-?\d+)(?:[,\s]+S(?:W)?\s*[:=]\s*(-?\d+))?/.exec(clean) ??
    /^(-?\d+)[,\s]+(-?\d+)(?:[,\s]+(-?\d+))?$/.exec(clean);
  if (m) {
    setState({
      telemetry: {
        x: Number(m[1]),
        y: Number(m[2]),
        sw: m[3] !== undefined ? Number(m[3]) : 1,
        raw: line.trim(),
        at: Date.now(),
      },
    });
  }
}

async function readLoop(port: SerialPortLike, mySession: number): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  let failures = 0;

  while (!ended && mySession === session && port.readable) {
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = port.readable.getReader();
    } catch {
      break;
    }
    activeReader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || mySession !== session) {
          ended = true;
          break;
        }
        failures = 0;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            handleLine(line);
          }
          if (buffer.length > 512) buffer = buffer.slice(-256);
        }
      }
    } catch {
      // A read error: either a glitch (the browser hands out a fresh stream and
      // the loop carries on) or the cable was pulled (port.readable is now null).
      failures += 1;
      if (failures > 20) ended = true;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
      if (activeReader === reader) activeReader = null;
    }
  }

  // Always close the port when reading stops, so it can be opened again later.
  try {
    await port.close();
  } catch {
    /* already closed or the device is gone */
  }

  if (mySession === session) {
    // Nobody asked for this — the controller went away on its own.
    session += 1;
    connected = false;
    readLoopDone = null;
    setState({
      status: "disconnected",
      telemetry: null,
      error: "Controller disconnected — plug it back in",
    });
  }
}

/** Stop reading and close the port, then wait until that has really happened. */
async function stopConnection(): Promise<void> {
  session += 1;
  const reader = activeReader;
  const done = readLoopDone;
  activeReader = null;
  readLoopDone = null;
  connected = false;
  try {
    await reader?.cancel();
  } catch {
    /* nothing to cancel */
  }
  if (done) {
    await Promise.race([
      done.catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 1200)),
    ]);
  }
}

function isAlreadyOpen(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "InvalidStateError" || /already open/i.test(err.message))
  );
}

async function attach(port: SerialPortLike, quiet: boolean): Promise<boolean> {
  await stopConnection();
  const mySession = ++session;
  setState({ status: "connecting", error: null });
  try {
    await port.open({ baudRate: BAUD_RATE });
  } catch (err) {
    if (!isAlreadyOpen(err)) {
      if (mySession === session) {
        setState(
          quiet
            ? { status: "disconnected", error: null }
            : { status: "error", error: messageOf(err) },
        );
      }
      return false;
    }
  }
  if (mySession !== session) return false;
  connected = true;
  setState({ status: "connected", error: null });
  readLoopDone = readLoop(port, mySession);
  return true;
}

/** Connect a controller. Needs a tap or click: the browser shows its port picker. */
export async function connectJoystick(): Promise<boolean> {
  if (!isSerialSupported() || !navigator.serial) {
    setState({
      status: "unsupported",
      error: "Web Serial is not supported in this browser. Use Chrome or Edge on desktop.",
    });
    return false;
  }
  try {
    const port = await navigator.serial.requestPort();
    return await attach(port, false);
  } catch (err) {
    const msg = messageOf(err);
    const cancelled =
      (err instanceof Error && err.name === "NotFoundError") ||
      /No port selected|cancel/i.test(msg);
    if (cancelled) {
      // picker closed without a choice: whatever was connected stays connected
      setState({ status: connected ? "connected" : "disconnected", error: null });
    } else {
      setState({ status: "error", error: msg });
    }
    return false;
  }
}

/** Reconnect to a controller the operator already allowed — no prompt, no click. */
export async function reconnectKnownJoystick(): Promise<boolean> {
  if (!isSerialSupported() || !navigator.serial || connected) return false;
  if (state.status === "connecting") return false;
  try {
    const ports = await navigator.serial.getPorts();
    if (ports.length === 0) return false;
    return await attach(ports[0], true);
  } catch {
    return false;
  }
}

export async function disconnectJoystick(): Promise<void> {
  await stopConnection();
  setState({
    status: isSerialSupported() ? "disconnected" : "unsupported",
    telemetry: null,
    error: null,
  });
}

function init() {
  if (initialised || typeof navigator === "undefined") return;
  initialised = true;
  if (!isSerialSupported() || !navigator.serial) {
    setState({ status: "unsupported" });
    return;
  }
  // A cable that is plugged back in reconnects without anyone touching the screen.
  navigator.serial.addEventListener?.("connect", () => {
    void reconnectKnownJoystick();
  });
  void reconnectKnownJoystick();
}

/** Joystick state + jump events for a screen. The connection itself outlives the screen. */
export function useSerialJoystick(onJump: () => void): SerialController {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
  const onJumpRef = useRef(onJump);

  useEffect(() => {
    onJumpRef.current = onJump;
  }, [onJump]);

  useEffect(() => {
    init();
    const listener = () => {
      try {
        onJumpRef.current();
      } catch {
        /* a failing jump handler must never break the read loop */
      }
    };
    jumpListeners.add(listener);
    return () => {
      jumpListeners.delete(listener);
    };
  }, []);

  return { ...snapshot, connect: connectJoystick, disconnect: disconnectJoystick };
}

// Keyboard helper: Space / ArrowUp / KeyW all count as jump.
export function isJumpKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW";
}
