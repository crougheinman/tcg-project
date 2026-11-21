import { PCard } from './CardPreview';
import type { CardInstance } from '../engine/types';

/**
 * A card that just changed zone because of a skill, shown in the middle of the table (visual only, click-through):
 *   discard (Plague Priest's Rot): the discarded card drops in from the victim's side face up in a sickly purple light,
 *     hangs for a beat, then rots away (greys, blurs, drifts up and fades) while spores rise off it;
 *   raise (Grave Necromancer's Grave Call): a green light blooms first, THEN the resurrected card gradually fades in out
 *     of it (blurred and over-bright, settling into focus), and finally slips away toward its owner's hand.
 * Every keyframe in index.css (.zfx*) is a share of --zfx-ms, so the durations in fxTiming.ts retime it.
 */
export function ZoneFx({ kind, card, side, ms }: { kind: 'discard' | 'raise'; card: CardInstance; side: 'me' | 'foe'; ms: number }) {
  return (
    <div className={`zfx ${kind} ${side}`} aria-hidden data-zfx={kind} style={{ ['--zfx-ms' as string]: `${ms}ms` }}>
      <div className="zfx-dim" />
      <div className="zfx-light" />
      <div className="zfx-beam" />
      <div className="zfx-body">
        <div className="cast-card zfx-card">
          <PCard inst={card} />
        </div>
        <div className="zfx-label">{kind === 'discard' ? 'Discarded' : 'Returned from the grave'}</div>
      </div>
      <div className="zfx-motes">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ ['--i' as string]: i }} />
        ))}
      </div>
    </div>
  );
}
