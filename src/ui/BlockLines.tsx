import { useEffect, useRef, useState } from 'react';

// Curved lines from a blocker to the attacker it blocks (or could block).
//
// Drawn on a fixed, click-through SVG layer OUTSIDE .board (the board is transformed during
// shakes, which would break fixed positioning). Endpoints sit on the two facing card edges,
// so a line only ever travels through the gap between the rows, never across a card face.
// Each curve then bows sideways, away from the middle of the screen where the action
// buttons live, so it is not hiding the prompt either.

export interface BlockLine {
  from: string; // blocker iid
  to: string; // attacker iid
  kind: 'set' | 'candidate'; // assigned | the selected blocker could take this attacker
}

interface Seg {
  key: string;
  kind: BlockLine['kind'];
  a: { x: number; y: number };
  b: { x: number; y: number };
  c: { x: number; y: number };
}

function rectOf(iid: string): DOMRect | null {
  return document.querySelector(`[data-iid="${iid}"]`)?.getBoundingClientRect() ?? null;
}

function measure(lines: BlockLine[]): Seg[] {
  const mid = window.innerWidth / 2;
  const out: Seg[] = [];
  lines.forEach((l, i) => {
    const f = rectOf(l.from);
    const t = rectOf(l.to);
    if (!f || !t) return;
    const fy = f.top + f.height / 2;
    const ty = t.top + t.height / 2;
    // facing edges: a blocker below its attacker starts at its top and ends at the attacker's bottom
    const a = { x: f.left + f.width / 2, y: ty < fy ? f.top : f.bottom };
    const b0 = { x: t.left + t.width / 2, y: ty < fy ? t.bottom : t.top };
    const dx = b0.x - a.x;
    const dy = b0.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const b = { x: b0.x - (dx / len) * 4, y: b0.y - (dy / len) * 4 }; // stop short: room for the arrowhead
    const n = { x: -dy / len, y: dx / len }; // unit normal
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const bow = Math.min(120, Math.max(34, len * 0.32));
    // bow toward whichever side is further from the screen centre; lines that run straight
    // up the middle alternate sides so they fan out rather than stack
    let sign = Math.abs(m.x + n.x * bow - mid) >= Math.abs(m.x - n.x * bow - mid) ? 1 : -1;
    if (Math.abs(m.x - mid) < 24) sign = i % 2 === 0 ? 1 : -1;
    out.push({
      key: `${l.kind}:${l.from}>${l.to}`,
      kind: l.kind,
      a,
      b,
      c: { x: m.x + n.x * bow * sign, y: m.y + n.y * bow * sign },
    });
  });
  return out;
}

export function BlockLines({ lines }: { lines: BlockLine[] }) {
  const [segs, setSegs] = useState<Seg[]>([]);
  const last = useRef('');
  const ref = useRef(lines);
  ref.current = lines;
  const sig = lines.map((l) => `${l.kind}:${l.from}>${l.to}`).join('|');

  useEffect(() => {
    if (!sig) {
      last.current = '';
      setSegs([]);
      return;
    }
    // Cards slide and settle, the window resizes: re-measure each frame while lines exist,
    // but only touch state when something actually moved.
    let raf = 0;
    const tick = () => {
      const next = measure(ref.current);
      const s = next
        .map((n) => `${n.key}@${n.a.x | 0},${n.a.y | 0},${n.b.x | 0},${n.b.y | 0}`)
        .join(';');
      if (s !== last.current) {
        last.current = s;
        setSegs(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sig]);

  if (segs.length === 0) return null;
  return (
    <svg className="block-lines" aria-hidden>
      <defs>
        <marker id="bl-arrow-set" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#22d3ee" stroke="#0a0c13" strokeWidth="1.2" />
        </marker>
        <marker id="bl-arrow-cand" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#ffd24a" />
        </marker>
      </defs>
      {segs.map((s) => {
        const d = `M ${s.a.x} ${s.a.y} Q ${s.c.x} ${s.c.y} ${s.b.x} ${s.b.y}`;
        return s.kind === 'set' ? (
          <g key={s.key}>
            <path className="bl-under" d={d} />
            <path className="bl-set" d={d} markerEnd="url(#bl-arrow-set)" />
            <circle className="bl-dot" cx={s.a.x} cy={s.a.y} r="5" />
          </g>
        ) : (
          <g key={s.key}>
            <path className="bl-cand" d={d} markerEnd="url(#bl-arrow-cand)" />
          </g>
        );
      })}
    </svg>
  );
}
