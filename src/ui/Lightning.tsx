// Blitz mark: a beast empowered by Beast Blitz crackles with yellow lightning that revolves around its
// card. Two jagged bolts race around the rim (stroke-dash windows sliding along a zig-zag outline) over a
// faint steady crackle and a pulsing glow. The SVG stretches to the card (viewBox + preserveAspectRatio
// "none", non-scaling strokes), so it fits hand cards, board creatures and the big preview alike. Pure CSS
// animation (.bolts / .bolt in index.css); click-through and hidden from assistive tech.
const W = 100;
const H = 140;

/** A closed zig-zag outline just inside the viewBox, jittered from a fixed seed so every card matches. */
function zigzag(seed: number, jitter: number): string {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const pts: [number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.round(len / 5);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const j = rnd() * jitter;
      pts.push([x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j]);
    }
  };
  const m = 2;
  edge(m, m, W - m, m, 0, 1); // top, left -> right
  edge(W - m, m, W - m, H - m, 1, 0); // right, down
  edge(W - m, H - m, m, H - m, 0, 1); // bottom, right -> left
  edge(m, H - m, m, m, 1, 0); // left, up
  return 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
}

const A = zigzag(7, 3.4);
const B = zigzag(23, 3.4);

export function Lightning() {
  return (
    <span className="bolts" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path className="bolt-base" d={A} pathLength={100} />
        <path className="bolt" d={A} pathLength={100} />
        <path className="bolt two" d={B} pathLength={100} />
      </svg>
    </span>
  );
}
