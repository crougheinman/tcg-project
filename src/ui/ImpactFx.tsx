import { motion } from 'framer-motion';

// Pure framer-motion impact effects — no spritesheets. Each is a burst of
// primitive shapes (rings / flashes / shards) themed by color.

/** Per-spell color theme (replaces the old spritesheet map). */
export interface SpellTheme {
  core: string; // hot centre flash
  glow: string; // mid glow / shards
  ring: string; // shockwave ring
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Inline sizing for a centered circle (framer owns transform, so center by margin). */
export const circle = (d: number) => ({ width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2 });

/** One-shot spell impact: core flash + double shockwave + 8 radial shards + afterglow. */
export function SpellImpactFx({ x, y, theme }: { x: number; y: number; theme: SpellTheme }) {
  return (
    <motion.div
      className="fx-point"
      style={{ left: x, top: y }}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      {/* core flash */}
      <motion.div
        className="fx-circle"
        style={{
          ...circle(90),
          background: `radial-gradient(circle, ${theme.core} 0%, ${theme.glow} 45%, transparent 70%)`,
          filter: `drop-shadow(0 0 26px ${theme.glow})`,
        }}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: [0, 1.5, 0.9], opacity: [1, 1, 0] }}
        transition={{ duration: 0.55, times: [0, 0.4, 1], ease: EASE_OUT }}
      />
      {/* double shockwave */}
      {[0, 0.12].map((delay, i) => (
        <motion.div
          key={i}
          className="fx-circle"
          style={{ ...circle(90), border: `3px solid ${theme.ring}` }}
          initial={{ scale: 0.2, opacity: 0.9 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 0.7, delay, ease: EASE_OUT }}
        />
      ))}
      {/* radial shards */}
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="fx-ray" style={{ transform: `rotate(${i * 45}deg)` }}>
          <motion.div
            className="fx-shard"
            style={{ background: `linear-gradient(90deg, ${theme.core}, ${theme.glow}, transparent)` }}
            initial={{ x: 6, opacity: 1, scaleX: 1 }}
            animate={{ x: 74, opacity: 0, scaleX: 0.3 }}
            transition={{ duration: 0.55, ease: EASE_OUT }}
          />
        </div>
      ))}
      {/* lingering afterglow so the cast reads even if you blink */}
      <motion.div
        className="fx-circle"
        style={{
          ...circle(130),
          background: `radial-gradient(circle, ${theme.glow}55 0%, transparent 65%)`,
          filter: 'blur(6px)',
        }}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: [0.6, 1.3, 1.5], opacity: [0, 0.85, 0] }}
        transition={{ duration: 1.2, times: [0, 0.35, 1], ease: 'easeOut' }}
      />
    </motion.div>
  );
}

/**
 * Charge-up before a heavy blast fires: the core swells and pulses faster as it
 * builds (peaks bunch closer together toward the end via an accelerating `times`
 * curve), embers get pulled inward, and a warning ring throbs along with it.
 * Duration matches the caller's charge window so it vanishes right as the bolt fires.
 */
export function ChargeFx({ x, y, theme, ms }: { x: number; y: number; theme: SpellTheme; ms: number }) {
  const PULSES = 9;
  const times: number[] = [];
  const coreScale: number[] = [];
  const coreOpacity: number[] = [];
  const ringScale: number[] = [];
  const ringOpacity: number[] = [];
  for (let i = 0; i <= PULSES; i++) {
    const t = Math.pow(i / PULSES, 1.6); // bunches later pulses closer together
    times.push(t);
    const grow = 0.55 + 0.65 * (i / PULSES); // core swells over the whole charge
    const dip = i % 2 === 0;
    coreScale.push(dip ? grow * 0.78 : grow);
    coreOpacity.push(Math.min(1, 0.4 + 0.6 * (i / PULSES)));
    ringScale.push(dip ? grow * 1.5 : grow * 1.9);
    ringOpacity.push(dip ? 0.25 : 0.55 + 0.25 * (i / PULSES));
  }

  const embers = Array.from({ length: 8 }, (_, i) => {
    const ang = (i / 8) * Math.PI * 2;
    return { dx: Math.cos(ang) * 70, dy: Math.sin(ang) * 70, delay: (i / 8) * 0.5 };
  });

  return (
    <div className="fx-point" style={{ left: x, top: y }}>
      {/* outer warning ring, throbbing in time with the core */}
      <motion.div
        className="fx-circle"
        style={{ ...circle(120), border: `2px solid ${theme.ring}` }}
        initial={{ scale: 0.6, opacity: 0.2 }}
        animate={{ scale: ringScale, opacity: ringOpacity }}
        transition={{ duration: ms / 1000, times, ease: 'easeInOut' }}
      />
      {/* embers pulled inward, gathering into the charge */}
      {embers.map((e, i) => (
        <motion.div
          key={i}
          className="fx-ember"
          style={{ width: 6, height: 6, marginLeft: -3, marginTop: -3 }}
          initial={{ x: e.dx, y: e.dy, opacity: 0 }}
          animate={{ x: 0, y: 0, opacity: [0, 1, 0] }}
          transition={{
            duration: 0.5,
            delay: e.delay,
            repeat: Infinity,
            repeatDelay: 0.15,
            ease: 'easeIn',
          }}
        />
      ))}
      {/* the charge itself, growing and brightening toward release */}
      <motion.div
        className="fx-circle"
        style={{
          ...circle(70),
          background: `radial-gradient(circle, ${theme.core} 0%, ${theme.glow} 55%, transparent 78%)`,
          filter: `drop-shadow(0 0 18px ${theme.glow})`,
        }}
        initial={{ scale: 0.3, opacity: 0.3 }}
        animate={{ scale: coreScale, opacity: coreOpacity }}
        transition={{ duration: ms / 1000, times, ease: 'easeInOut' }}
      />
    </div>
  );
}

/** Creature smashed onto the table: flattened shock ring + dust puffs kicked out sideways. */
export function SmashDustFx({ x, y }: { x: number; y: number }) {
  // symmetric puffs, deterministic spread (3 left, 3 right)
  const puffs = [-1, -1, -1, 1, 1, 1].map((dir, i) => ({
    dx: dir * (18 + (i % 3) * 17),
    dy: -4 - (i % 3) * 5,
    size: 14 + (i % 3) * 5,
    delay: (i % 3) * 0.045,
  }));
  return (
    <div className="fx-point" style={{ left: x, top: y }}>
      {/* flattened shockwave hugging the table */}
      <motion.div
        className="fx-dustring"
        initial={{ scaleX: 0.3, scaleY: 0.5, opacity: 0.85 }}
        animate={{ scaleX: 2.1, scaleY: 0.8, opacity: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
      />
      {puffs.map((p, i) => (
        <motion.div
          key={i}
          className="fx-dust"
          style={{ width: p.size, height: p.size, marginLeft: -p.size / 2, marginTop: -p.size / 2 }}
          initial={{ x: 0, y: 0, opacity: 0.9, scale: 0.4 }}
          animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 1.25 }}
          transition={{ duration: 0.55, delay: p.delay, ease: EASE_OUT }}
        />
      ))}
    </div>
  );
}

/** Mana orb consumed at the avatar: a blue glow flash + shock ring + dispersing
 * blue smoke puffs. One-shot, ~0.9s. */
export function ManaConsumeFx({ x, y }: { x: number; y: number }) {
  const BLUE = '#6aa9ff';
  const puffs = Array.from({ length: 6 }, (_, i) => {
    const ang = (i / 6) * Math.PI * 2;
    return { dx: Math.cos(ang) * 26, dy: Math.sin(ang) * 26 - 8, size: 16 + ((i * 5) % 12), delay: (i % 3) * 0.05 };
  });
  return (
    <div className="fx-point" style={{ left: x, top: y }}>
      {/* blue glow flash */}
      <motion.div
        className="fx-circle"
        style={{ ...circle(66), background: `radial-gradient(circle, #dfefff 0%, ${BLUE} 45%, transparent 72%)`, filter: `drop-shadow(0 0 22px ${BLUE})` }}
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: [0.3, 1.3, 1.7], opacity: [0, 0.95, 0] }}
        transition={{ duration: 0.7, times: [0, 0.4, 1], ease: 'easeOut' }}
      />
      {/* shock ring */}
      <motion.div
        className="fx-circle"
        style={{ ...circle(60), border: `2px solid ${BLUE}` }}
        initial={{ scale: 0.3, opacity: 0.85 }}
        animate={{ scale: 2.3, opacity: 0 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      />
      {/* blue smoke puffs dispersing up + out */}
      {puffs.map((p, i) => (
        <motion.div
          key={i}
          className="fx-smokepuff"
          style={{
            width: p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            background: `radial-gradient(circle, ${BLUE}cc 0%, ${BLUE}44 55%, transparent 76%)`,
          }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: p.dx, y: [p.dy, p.dy - 22], opacity: [0, 0.8, 0], scale: [0.4, 1, 1.5] }}
          transition={{ duration: 0.9, delay: 0.05 + p.delay, times: [0, 0.35, 1], ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/** Soul Siphon: green souls stream in from all sides and get pulled INTO the avatar
 * for `ms`, over a pulsing green aura. */
export function SoulSiphonFx({ x, y, ms }: { x: number; y: number; ms: number }) {
  const GREEN = '#6ee06a';
  const souls = Array.from({ length: 12 }, (_, i) => {
    const ang = (i / 12) * Math.PI * 2;
    const dist = 80 + ((i * 19) % 70);
    return {
      fx: Math.cos(ang) * dist,
      fy: Math.sin(ang) * dist,
      size: 7 + ((i * 5) % 9),
      delay: (i % 6) * 0.12,
      dur: 0.8 + (i % 3) * 0.15,
    };
  });
  return (
    <div className="fx-point" style={{ left: x, top: y }}>
      {/* pulsing green aura at the avatar for the whole drain */}
      <motion.div
        className="fx-circle"
        style={{ ...circle(72), background: `radial-gradient(circle, ${GREEN}55 0%, transparent 68%)`, filter: 'blur(5px)' }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 0.7, 0.6, 0.7, 0], scale: [0.7, 1.1, 1, 1.15, 0.85] }}
        transition={{ duration: ms / 1000, times: [0, 0.15, 0.5, 0.85, 1], ease: 'easeInOut' }}
      />
      {souls.map((s, i) => (
        <motion.div
          key={i}
          className="fx-soul"
          style={{
            width: s.size,
            height: s.size,
            marginLeft: -s.size / 2,
            marginTop: -s.size / 2,
            background: `radial-gradient(circle at 40% 35%, #d8ffcf, ${GREEN} 55%, transparent 80%)`,
          }}
          initial={{ x: s.fx, y: s.fy, opacity: 0, scale: 0.4 }}
          animate={{ x: [s.fx, 0], y: [s.fy, 0], opacity: [0, 0.95, 0], scale: [0.4, 1, 0.2] }}
          transition={{
            duration: s.dur,
            delay: s.delay,
            repeat: Infinity,
            repeatDelay: 0.12,
            times: [0, 0.7, 1],
            ease: 'easeIn',
          }}
        />
      ))}
    </div>
  );
}

/** Rising glowing smoke plume at a target for `ms` (violet = Grasp, green = Withering). */
export function SmokeFx({ x, y, color, ms }: { x: number; y: number; color: string; ms: number }) {
  const puffs = Array.from({ length: 6 }, (_, i) => ({
    dx: (i - 2.5) * 8,
    size: 22 + ((i * 7) % 16),
    delay: i * 0.16,
  }));
  return (
    <div className="fx-point fx-smokeplume" style={{ left: x, top: y }}>
      {/* soft glow held for the whole window */}
      <motion.div
        className="fx-circle"
        style={{ ...circle(76), background: `radial-gradient(circle, ${color}66 0%, transparent 65%)`, filter: 'blur(7px)' }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0.75, 0.6, 0], scale: [0.6, 1.1, 1.15, 0.9] }}
        transition={{ duration: ms / 1000, times: [0, 0.15, 0.75, 1], ease: 'easeInOut' }}
      />
      {puffs.map((p, i) => (
        <motion.div
          key={i}
          className="fx-smokepuff"
          style={{
            width: p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            background: `radial-gradient(circle, ${color}dd 0%, ${color}55 55%, transparent 76%)`,
          }}
          initial={{ opacity: 0, x: 0, y: 8, scale: 0.5 }}
          animate={{ opacity: [0, 0.85, 0], x: [0, p.dx, p.dx * 1.4], y: [8, -18, -42], scale: [0.5, 1, 1.6] }}
          transition={{ duration: 1.1, delay: p.delay, repeat: Infinity, repeatDelay: 0.05, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/** Stone debris burst: a shock ring + gray chunks flung out that tumble and fall. */
export function DebrisFx({ x, y }: { x: number; y: number }) {
  const chunks = Array.from({ length: 11 }, (_, i) => {
    const ang = (i / 11) * Math.PI * 2 + 0.3;
    const d = 40 + ((i * 13) % 40);
    return {
      dx: Math.cos(ang) * d,
      dy: Math.sin(ang) * d * 0.7,
      size: 5 + ((i * 5) % 9),
      rot: (i * 57) % 360,
      dur: 0.7 + (i % 3) * 0.15,
    };
  });
  return (
    <div className="fx-point fx-debrisburst" style={{ left: x, top: y }}>
      <motion.div
        className="fx-circle"
        style={{ ...circle(80), border: '2px solid #8a8175' }}
        initial={{ scale: 0.3, opacity: 0.75 }}
        animate={{ scale: 2.1, opacity: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      />
      {chunks.map((c, i) => (
        <motion.div
          key={i}
          className="fx-debris"
          style={{ width: c.size, height: c.size, marginLeft: -c.size / 2, marginTop: -c.size / 2 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: [0, c.dx, c.dx * 1.1], y: [0, c.dy, c.dy + 44], opacity: [1, 1, 0], rotate: c.rot }}
          transition={{ duration: c.dur, times: [0, 0.5, 1], ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/** Wither: a sickly green flash collapsing inward + withered flecks drifting down. */
export function WitherFx({ x, y }: { x: number; y: number }) {
  const flecks = Array.from({ length: 9 }, (_, i) => {
    const ang = (i / 9) * Math.PI * 2;
    return { dx: Math.cos(ang) * 30, dy: Math.sin(ang) * 30, size: 4 + ((i * 3) % 6), delay: (i % 4) * 0.05 };
  });
  return (
    <div className="fx-point fx-wither" style={{ left: x, top: y }}>
      <motion.div
        className="fx-circle"
        style={{
          ...circle(92),
          background: 'radial-gradient(circle, #c8ff9a 0%, #4a8a2e 45%, transparent 72%)',
          filter: 'drop-shadow(0 0 18px rgba(120, 200, 80, 0.8))',
        }}
        initial={{ scale: 1.35, opacity: 0 }}
        animate={{ scale: [1.35, 0.9, 0.4], opacity: [0, 0.9, 0] }}
        transition={{ duration: 0.9, times: [0, 0.4, 1], ease: 'easeIn' }}
      />
      {flecks.map((f, i) => (
        <motion.div
          key={i}
          className="fx-debris wither"
          style={{ width: f.size, height: f.size, marginLeft: -f.size / 2, marginTop: -f.size / 2 }}
          initial={{ x: f.dx, y: f.dy, opacity: 0 }}
          animate={{ x: f.dx * 0.3, y: [f.dy, f.dy + 34], opacity: [0, 1, 0] }}
          transition={{ duration: 0.9, delay: f.delay, times: [0, 0.3, 1], ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

/** Quick melee slash: two crossing streaks + a spark, ~0.4s. */
export function SlashFx({ x, y }: { x: number; y: number }) {
  return (
    <div className="fx-point" style={{ left: x, top: y }}>
      <motion.div
        className="fx-slash"
        style={{ rotate: -32 }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: [0, 1, 1], opacity: [0, 1, 0], x: [-40, 0, 26] }}
        transition={{ duration: 0.3, times: [0, 0.35, 1], ease: 'easeOut' }}
      />
      <motion.div
        className="fx-slash"
        style={{ rotate: 24 }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: [0, 1, 1], opacity: [0, 1, 0], x: [36, 0, -22] }}
        transition={{ duration: 0.3, delay: 0.09, times: [0, 0.35, 1], ease: 'easeOut' }}
      />
      <motion.div
        className="fx-circle"
        style={{
          ...circle(34),
          background: 'radial-gradient(circle, #fff 0%, #ffd0c0 40%, transparent 70%)',
        }}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: [0, 1.2, 0.6], opacity: [1, 0.9, 0] }}
        transition={{ duration: 0.32, delay: 0.06, times: [0, 0.4, 1], ease: 'easeOut' }}
      />
    </div>
  );
}
