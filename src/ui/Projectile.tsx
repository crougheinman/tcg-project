import { useEffect, useRef } from 'react';

import type { SpellTheme } from './ImpactFx';

// A fast projectile that flies from the caster to the exact target (a creature or
// a player), shaking it on impact. onImpact fires the themed burst at the target so
// it lands with the projectile. `kind` picks the visual: a fiery bolt (default) or
// a spinning shuriken (Shuriken Volley).
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
  targetSel: string | null; // DOM selector of the thing hit (for the impact shake); null if it's gone
  theme: SpellTheme; // impact burst colors
  kind?: 'bolt' | 'shuriken';
}

const TRAVEL_MS = 340;
const SHURIKEN_MS = 210; // shurikens are quick

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
  const shuriken = fx.kind === 'shuriken';

  useEffect(() => {
    const dx = fx.toX - fx.fromX;
    const dy = fx.toY - fx.fromY;
    const dur = shuriken ? SHURIKEN_MS : TRAVEL_MS;
    const impact = () => {
      // Shake the target — the `.stack` wrapper for a creature (so we don't fight
      // framer's transform on the card), or the element itself for a player.
      const raw = fx.targetSel ? document.querySelector(fx.targetSel) : null;
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
      const t = setTimeout(impact, dur);
      return () => clearTimeout(t);
    }
    const frames: Keyframe[] = shuriken
      ? [
          { transform: 'translate(0,0) rotate(0deg) scale(0.7)', opacity: 0, offset: 0 },
          { transform: 'translate(0,0) rotate(180deg) scale(1)', opacity: 1, offset: 0.12 },
          { transform: `translate(${dx}px, ${dy}px) rotate(1440deg) scale(1)`, opacity: 1, offset: 1 },
        ]
      : [
          { transform: 'translate(0,0) scale(0.6)', opacity: 0, offset: 0 },
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0.15 },
          { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1, offset: 1 },
        ];
    const anim = node.animate(frames, {
      duration: dur,
      easing: shuriken ? 'cubic-bezier(.2,.6,.4,1)' : 'cubic-bezier(.4,0,.7,1)',
      fill: 'forwards',
    });
    anim.onfinish = impact;
    return () => anim.cancel();
  }, [fx, onImpact, onDone, shuriken]);

  // Pinned at the start point; CSS margin centers it, WAAPI drives the flight.
  return (
    <div ref={ref} className={shuriken ? 'shuriken-proj' : 'spell-bolt'} style={{ left: fx.fromX, top: fx.fromY }} />
  );
}
