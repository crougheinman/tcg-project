import { useEffect, useRef } from 'react';

import type { SpellTheme } from './ImpactFx';
import { FIST_TRAVEL_MS, PROJECTILE_TRAVEL_MS, SHURIKEN_TRAVEL_MS } from './fxTiming';

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
  kind?: 'bolt' | 'shuriken' | 'fist'; // 'fist': Pyre Adept's flaming punch
}

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
  const fist = fx.kind === 'fist';

  useEffect(() => {
    const dx = fx.toX - fx.fromX;
    const dy = fx.toY - fx.fromY;
    const dur = shuriken ? SHURIKEN_TRAVEL_MS : fist ? FIST_TRAVEL_MS : PROJECTILE_TRAVEL_MS;
    const impact = () => {
      // Shake the target — the `.stack` wrapper for a creature (so we don't fight
      // framer's transform on the card), or the element itself for a player.
      const raw = fx.targetSel ? document.querySelector(fx.targetSel) : null;
      const el = (raw?.closest('.stack') ?? raw) as HTMLElement | null;
      // a punch hits harder than a bolt: it knocks the target back along the line of the blow
      const len = Math.hypot(dx, dy) || 1;
      const kx = fist ? (dx / len) * 14 : 0;
      const ky = fist ? (dy / len) * 14 : 0;
      el?.animate(
        fist
          ? [
              { transform: 'translate(0,0)' },
              { transform: `translate(${kx}px,${ky}px) scale(0.96)`, offset: 0.18 },
              { transform: `translate(${-kx * 0.5}px,${-ky * 0.5}px)`, offset: 0.5 },
              { transform: `translate(${kx * 0.25}px,${ky * 0.25}px)`, offset: 0.75 },
              { transform: 'translate(0,0)' },
            ]
          : [
              { transform: 'translate(0,0)' },
              { transform: 'translate(-5px,3px)' },
              { transform: 'translate(5px,-2px)' },
              { transform: 'translate(-3px,1px)' },
              { transform: 'translate(0,0)' },
            ],
        { duration: fist ? 420 : 280, easing: 'ease-out' },
      );
      onImpact(fx);
      onDone(fx.id);
    };

    const node = ref.current;
    if (!node) {
      const t = setTimeout(impact, dur);
      return () => clearTimeout(t);
    }
    const frames: Keyframe[] = fist
      ? [
          { transform: 'translate(0,0) scale(0.5)', opacity: 0, offset: 0 },
          { transform: `translate(${dx * 0.08}px, ${dy * 0.08}px) scale(1.1)`, opacity: 1, offset: 0.12 },
          { transform: `translate(${dx}px, ${dy}px) scale(1.7)`, opacity: 1, offset: 1 },
        ]
      : shuriken
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
      easing: shuriken ? 'cubic-bezier(.2,.6,.4,1)' : fist ? 'cubic-bezier(.6,0,.95,.4)' : 'cubic-bezier(.4,0,.7,1)',
      fill: 'forwards',
    });
    anim.onfinish = impact;
    return () => anim.cancel();
  }, [fx, onImpact, onDone, shuriken, fist]);

  // Pinned at the start point; CSS margin centers it, WAAPI drives the flight.
  if (fist) {
    // The fist is drawn pointing along +x and turned by the angle of the blow. The turn lives on an inner element
    // (individual `rotate`) so it does not rotate the flight path the WAAPI transform drives on the outer one.
    const deg = (Math.atan2(fx.toY - fx.fromY, fx.toX - fx.fromX) * 180) / Math.PI;
    return (
      <div ref={ref} className="fire-fist" style={{ left: fx.fromX, top: fx.fromY }}>
        <div className="ff-turn" style={{ rotate: `${deg}deg` }}>
          <span className="ff-tail" />
          <svg className="ff-hand" viewBox="0 0 44 34" aria-hidden>
            <defs>
              <radialGradient id="ff-grad" cx="70%" cy="40%" r="75%">
                <stop offset="0" stopColor="#fffbe8" />
                <stop offset="0.35" stopColor="#ffd65a" />
                <stop offset="0.7" stopColor="#ff7a24" />
                <stop offset="1" stopColor="#d6321d" />
              </radialGradient>
            </defs>
            <rect x="2" y="11" width="12" height="13" rx="4" fill="url(#ff-grad)" />
            <rect x="9" y="6" width="25" height="22" rx="7" fill="url(#ff-grad)" />
            <circle cx="35" cy="10" r="5.4" fill="url(#ff-grad)" />
            <circle cx="37" cy="17" r="5.6" fill="url(#ff-grad)" />
            <circle cx="35" cy="24" r="5.4" fill="url(#ff-grad)" />
            <path d="M33 6 v22 M25 7 v20" stroke="#b3260f" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
          </svg>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className={shuriken ? 'shuriken-proj' : 'spell-bolt'} style={{ left: fx.fromX, top: fx.fromY }} />
  );
}
