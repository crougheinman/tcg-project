import { motion } from 'framer-motion';
import { getDef } from '../cards/cards';
import { power, toughness } from '../engine/rules';
import type { CardInstance } from '../engine/types';

// Large hover preview — parchment card frame (name ribbon, cost orb, art window,
// type banner, rules scroll, P/T shield). Springs in on the right, click-through.
const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };

function artFallback(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.src.endsWith('.png')) img.src = img.src.replace(/\.png$/, '.svg');
  else img.style.visibility = 'hidden';
}

export function CardPreview({ inst }: { inst: CardInstance }) {
  const def = getDef(inst.def);
  const isCreature = def.type === 'creature';
  const subtype = isCreature ? `Creature — ${creatureSubtype(def.id)}` : def.type;

  return (
    <motion.div
      className="card-preview-wrap"
      initial={{ opacity: 0, x: -40, scale: 0.85 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -40, scale: 0.85 }}
      transition={spring}
    >
      <div className={`pcard pcard-${def.type}`}>
        <div className="pcard-banner">
          <span className="pcard-name">{def.name}</span>
        </div>
        {def.type !== 'land' && <span className="pcard-orb">{def.cost}</span>}

        <div className="pcard-artwin">
          {def.art && <img className="pcard-art" src={def.art} alt="" onError={artFallback} />}
        </div>

        <div className="pcard-typeband">
          <span className="pcard-pip" aria-hidden>
            ◆
          </span>
          {subtype}
        </div>

        <div className="pcard-rules">
          {def.text && <p className="pcard-text">{def.text}</p>}
          {def.flavor && <p className="pcard-flavor">{def.flavor}</p>}
        </div>

        {isCreature && (
          <div className="pcard-shield">
            <span className={inst.damage > 0 ? 'damaged' : ''}>
              {power(inst)}/{toughness(inst) - inst.damage}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Flavorful subtype label for the type banner (cosmetic only).
function creatureSubtype(id: string): string {
  const map: Record<string, string> = {
    ember_sprite: 'Sprite',
    swift_lancer: 'Soldier',
    stoneback_cub: 'Beast',
    sky_talon: 'Bird',
    thornwood_brute: 'Treefolk',
    granite_sentinel: 'Golem',
    storm_drake: 'Drake',
    dread_maw: 'Horror',
  };
  return map[id] ?? 'Creature';
}
