import { useEffect, useState, type CSSProperties } from 'react';

// 2.5s destruction sequence played on a dying card: dark-bolt -> explosion-1 -> fire-bomb.
// Each sheet is a spritesheet; cols/rows describe its frame grid.
const PHASES = [
  { sheet: '/effects/dark-bolt.png', cols: 8, rows: 1 },
  { sheet: '/effects/explosion-1.png', cols: 4, rows: 4 },
  { sheet: '/effects/fire-bomb.png', cols: 14, rows: 1 },
];
const PHASE_MS = 833; // ~2.5s total over 3 phases
const SIZE = 160;

export function DestroyFx({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      if (i < PHASES.length - 1) setI(i + 1);
      else onDone();
    }, PHASE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const p = PHASES[i];
  return (
    <div
      key={i}
      className="destroyfx"
      style={
        {
          left: x,
          top: y,
          backgroundImage: `url(${p.sheet})`,
          backgroundSize: `${SIZE * p.cols}px ${SIZE * p.rows}px`,
          '--cols': p.cols,
          '--rows': p.rows,
          '--dur': `${PHASE_MS}ms`,
        } as CSSProperties
      }
    />
  );
}
