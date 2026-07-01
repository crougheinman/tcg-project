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
