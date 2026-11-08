import type { CardDef } from '../engine/types';
import { artFallback } from './artFallback';

// The shared card face (name / cost / art / rules text / power-toughness), used
// by the Card Codex and the Deck Builder so a card looks identical everywhere it
// appears outside the board.


export function CardFace({ def }: { def: CardDef }) {
  return (
    <>
      <div className="card-top">
        <span className="card-name">{def.name}</span>
        {def.type !== 'land' && <span className="card-cost">{def.cost}</span>}
      </div>
      <div className="card-type">{def.type}</div>
      {def.art && (
        <img className="card-art" src={def.art} alt="" draggable={false} onError={artFallback} />
      )}
      {def.text && <div className="card-text">{def.text}</div>}
      <div className="card-bottom">
        {def.type === 'creature' && (
          <span className="card-pt">
            {def.power}/{def.toughness}
          </span>
        )}
      </div>
    </>
  );
}
