import type { Cue } from './cues';

// Synthesized sound effects — no audio files.
//
// This mirrors what ImpactFx does for visuals ("pure framer-motion, no
// spritesheets"): every sound is built from oscillators and filtered noise at
// runtime, so the whole audio system costs zero bytes of payload. That matters
// for a game whose public/ folder is already the heaviest thing it ships.
//
// Everything degrades to a silent no-op when WebAudio is unavailable (jsdom in
// tests, older webviews), so callers never have to guard.

const MUTE_KEY = 'muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false; // storage can throw in private mode; audio on is the default
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (master && ctx) master.gain.setTargetAtTime(v ? 0 : 0.9, ctx.currentTime, 0.01);
}

/**
 * The AudioContext is created on first use, not at import: browsers start it
 * suspended until a user gesture, and sounds here are always downstream of a
 * click or key press, so this resumes at exactly the right moment.
 */
function audio(): { ctx: AudioContext; master: GainNode } | null {
  if (muted) return null;
  if (ctx && master) {
    if (ctx.state === 'suspended') void ctx.resume();
    return { ctx, master };
  }
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null; // no WebAudio (jsdom, old webview) -> silence
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    if (ctx.state === 'suspended') void ctx.resume();
    return { ctx, master };
  } catch {
    return null;
  }
}

interface ToneOpts {
  freq: number;
  to?: number; // sweep target
  dur?: number;
  type?: OscillatorType;
  peak?: number;
  delay?: number;
}

function tone(a: { ctx: AudioContext; master: GainNode }, o: ToneOpts): void {
  const { ctx: c, master: m } = a;
  const t0 = c.currentTime + (o.delay ?? 0);
  const dur = o.dur ?? 0.15;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
  // Short attack, exponential decay — a click-free pluck.
  const peak = o.peak ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(m);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(
  a: { ctx: AudioContext; master: GainNode },
  o: { dur?: number; peak?: number; lp?: number; lpTo?: number; hp?: number; delay?: number },
): void {
  const { ctx: c, master: m } = a;
  const dur = o.dur ?? 0.2;
  const t0 = c.currentTime + (o.delay ?? 0);
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  const peak = o.peak ?? 0.2;
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node: AudioNode = src;
  if (o.lp !== undefined) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.lp, t0);
    if (o.lpTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpTo), t0 + dur);
    node = node.connect(f);
  }
  if (o.hp !== undefined) {
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = o.hp;
    node = node.connect(f);
  }
  node.connect(g).connect(m);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** Recipes. Kept short and dry so they never step on the music of play. */
const RECIPES: Record<Cue, (a: { ctx: AudioContext; master: GainNode }) => void> = {
  land: (a) => {
    tone(a, { freq: 180, to: 90, dur: 0.14, type: 'sine', peak: 0.35 });
    noise(a, { dur: 0.08, peak: 0.08, lp: 900 });
  },
  creature: (a) => {
    tone(a, { freq: 180, to: 300, dur: 0.22, type: 'sawtooth', peak: 0.16 });
    tone(a, { freq: 270, to: 450, dur: 0.2, type: 'triangle', peak: 0.12, delay: 0.03 });
  },
  spell: (a) => {
    tone(a, { freq: 520, to: 820, dur: 0.2, type: 'triangle', peak: 0.16 });
    tone(a, { freq: 780, to: 1240, dur: 0.16, type: 'sine', peak: 0.09, delay: 0.05 });
  },
  burn: (a) => {
    noise(a, { dur: 0.26, peak: 0.22, lp: 4000, lpTo: 300 });
    tone(a, { freq: 900, to: 160, dur: 0.24, type: 'sawtooth', peak: 0.16 });
  },
  heal: (a) => {
    tone(a, { freq: 523, dur: 0.35, type: 'sine', peak: 0.14 });
    tone(a, { freq: 659, dur: 0.33, type: 'sine', peak: 0.12, delay: 0.06 });
    tone(a, { freq: 784, dur: 0.33, type: 'sine', peak: 0.1, delay: 0.12 });
  },
  attack: (a) => {
    noise(a, { dur: 0.16, peak: 0.2, hp: 2200 });
    tone(a, { freq: 320, to: 150, dur: 0.16, type: 'square', peak: 0.1 });
  },
  block: (a) => {
    tone(a, { freq: 420, dur: 0.16, type: 'square', peak: 0.12 });
    tone(a, { freq: 630, dur: 0.14, type: 'square', peak: 0.09, delay: 0.015 });
    noise(a, { dur: 0.12, peak: 0.14, hp: 3000 });
  },
  death: (a) => {
    noise(a, { dur: 0.34, peak: 0.22, lp: 1400, lpTo: 90 });
    tone(a, { freq: 140, to: 60, dur: 0.3, type: 'sine', peak: 0.18 });
  },
  turn: (a) => tone(a, { freq: 440, dur: 0.07, type: 'sine', peak: 0.1 }),
  win: (a) => {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(a, { freq: f, dur: 0.42, type: 'triangle', peak: 0.16, delay: i * 0.1 }),
    );
  },
  lose: (a) => {
    [392, 330, 262].forEach((f, i) =>
      tone(a, { freq: f, dur: 0.5, type: 'sine', peak: 0.16, delay: i * 0.14 }),
    );
  },
};

/** Play one cue. Silent and harmless when muted or when WebAudio is missing. */
export function playCue(cue: Cue): void {
  const a = audio();
  if (!a) return;
  try {
    RECIPES[cue]?.(a);
  } catch {
    /* a failed sound must never break a turn */
  }
}

export function playCues(cues: readonly Cue[]): void {
  for (const c of cues) playCue(c);
}
