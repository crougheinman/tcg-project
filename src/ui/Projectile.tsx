import { useEffect, useRef } from 'react';

// A fast damage-spell bolt that flies from the caster's avatar to the exact target
// (a creature or a player), shaking it on impact. onImpact fires the explosion
// spritesheet at the target so it lands with the bolt.
//
// Travel is driven imperatively via the Web Animations API (like the board's
// lungeTo/shakeEl helpers) — reliable and conflict-free, unlike animating
// left/top through framer.
export interface Projectile {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  targetSel: string; // DOM selector of the thing being hit (for the impact shake)
  sheet: string;
  frames: number;
}

const TRAVEL_MS = 340;

export function ProjectileFx({
  fx,
  onImpact,
  onDone,
}: {
  fx: Projectile;
  onImpact: (fx: Projectile) => void;
  onDone: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dx = fx.toX - fx.fromX;
    const dy = fx.toY - fx.fromY;
    const impact = () => {
      // Shake the target — the `.stack` wrapper for a creature (so we don't fight
      // framer's transform on the card), or the element itself for a player.
      const raw = document.querySelector(fx.targetSel);
      const el = (raw?.closest('.stack') ?? raw) as HTMLElement | null;
      el?.animate(
        [
          { transform: 'translate(0,0)' },
          { transform: 'translate(-5px,3px)' },
          { transform: 'translate(5px,-2px)' },
          { transform: 'translate(-3px,1px)' },
          { transform: 'translate(0,0)' },
        ],
        { duration: 280, easing: 'ease-out' },
      );
      onImpact(fx);
      onDone(fx.id);
    };

    const node = ref.current;
    if (!node) {
      const t = setTimeout(impact, TRAVEL_MS);
      return () => clearTimeout(t);
    }
    const anim = node.animate(
      [
        { transform: 'translate(0,0) scale(0.6)', opacity: 0, offset: 0 },
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0.15 },
        { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1, offset: 1 },
      ],
      { duration: TRAVEL_MS, easing: 'cubic-bezier(.4,0,.7,1)', fill: 'forwards' },
    );
    anim.onfinish = impact;
    return () => anim.cancel();
  }, [fx, onImpact, onDone]);

  // Pinned at the start point; CSS margin centers it, WAAPI drives the flight.
  return <div ref={ref} className="spell-bolt" style={{ left: fx.fromX, top: fx.fromY }} />;
}
