import { useMemo } from 'react';
import { DEATH_CRACK_MS, DEATH_DUST_MS } from './fxTiming';

// A creature killed in combat: the strike lands, the card CRACKS (DEATH_CRACK_MS), then it is
// PULVERIZED into pieces that burst out and vanish (DEATH_DUST_MS).
//  - CrackFx is portalled INTO the card's stack by BoardFx, so the cracks ride along if the card is
//    mid-lunge. It hides itself when the crack time is up.
//  - DustFx spawns at that moment, fixed over the card, as tiles cut from the card's own art. The real
//    card is removed at the same instant (Board's exit delay uses the same numbers), so they take over
//    seamlessly.
// Pure CSS, click-through, hidden from assistive tech. Timeline lives in .sh-* in index.css.

const COLS = 4;
const ROWS = 5;

// A fault line from the strike point (centre) out to the edges, with a few side branches.
const CRACK_MAIN =
  'M52 46 L44 36 L49 26 L40 15 L44 0 M52 46 L62 40 L60 30 L72 22 L78 8 M52 46 L45 56 L52 66 L42 78 L47 100 M52 46 L63 54 L60 65 L70 74 L66 100 M52 46 L35 48 L24 44 L12 50 L0 46 M52 46 L72 50 L84 46 L100 52';
const CRACK_BRANCH = 'M44 36 L33 32 M60 30 L68 36 M52 66 L62 72 M24 44 L18 34 M72 50 L80 58';

export function CrackFx() {
  return (
    <span className="crackfx" style={{ ['--crack' as string]: `${DEATH_CRACK_MS}ms` } as React.CSSProperties} aria-hidden>
      <svg className="sh-crack" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path className="sh-line-dark" d={CRACK_MAIN} pathLength={1} />
        <path className="sh-line-lite" d={CRACK_MAIN} pathLength={1} />
        <path className="sh-line-dark thin" d={CRACK_BRANCH} pathLength={1} />
      </svg>
      <i className="sh-flash" />
    </span>
  );
}

export function DustFx({
  x,
  y,
  w,
  h,
  art,
  rot = 0,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  art?: string;
  rot?: number;
}) {
  const tw = w / COLS;
  const th = h / ROWS;
  // Random but stable per instance: each tile's burst vector, spin and stagger.
  const tiles = useMemo(
    () =>
      Array.from({ length: COLS * ROWS }, (_, i) => {
        const c = i % COLS;
        const r = Math.floor(i / COLS);
        const dx = (c - (COLS - 1) / 2) * 26 + (Math.random() - 0.5) * 30;
        const dy = (r - (ROWS - 1) / 2) * 22 + (Math.random() - 0.3) * 30 + 14; // a little gravity
        return { c, r, dx, dy, spin: (Math.random() - 0.5) * 220 };
      }),
    [],
  );
  const style = {
    left: x - w / 2,
    top: y - h / 2,
    width: w,
    height: h,
    transform: rot ? `rotate(${rot}deg)` : undefined,
    ['--dust' as string]: `${DEATH_DUST_MS}ms`,
  } as React.CSSProperties;
  return (
    <div className="dustfx" style={style} aria-hidden>
      {tiles.map((t) => (
        <i
          key={`${t.c}-${t.r}`}
          className="sh-tile"
          style={{
            left: t.c * tw,
            top: t.r * th,
            width: tw + 0.5,
            height: th + 0.5,
            backgroundImage: art ? `url(${art})` : undefined,
            backgroundSize: `${w}px ${h}px`,
            backgroundPosition: `${-t.c * tw}px ${-t.r * th}px`,
            ['--dx' as string]: `${t.dx}px`,
            ['--dy' as string]: `${t.dy}px`,
            ['--spin' as string]: `${t.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
