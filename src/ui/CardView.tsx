import { getDef } from '../cards/cards';
import { power, toughness } from '../engine/rules';
import type { CardInstance } from '../engine/types';

interface Props {
  inst: CardInstance;
  faceDown?: boolean;
  selected?: boolean;
  targetable?: boolean;
  dim?: boolean;
  onClick?: () => void;
}

export function CardView({ inst, faceDown, selected, targetable, dim, onClick }: Props) {
  if (faceDown) {
    return <div className="card card-back" />;
  }
  const def = getDef(inst.def);
  const cls = [
    'card',
    `card-${def.type}`,
    inst.tapped ? 'tapped' : '',
    selected ? 'selected' : '',
    targetable ? 'targetable' : '',
    dim ? 'dim' : '',
    onClick ? 'clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isCreature = def.type === 'creature';
  const pwr = power(inst);
  const tuf = toughness(inst);

  return (
    <div className={cls} onClick={onClick} title={def.text}>
      <div className="card-top">
        <span className="card-name">{def.name}</span>
        {def.type !== 'land' && <span className="card-cost">{def.cost}</span>}
      </div>
      <div className="card-type">{def.type}</div>
      {def.art && (
        <img
          className="card-art"
          src={def.art}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      {def.text && <div className="card-text">{def.text}</div>}
      <div className="card-bottom">
        {isCreature && (
          <span className={'card-pt' + (inst.damage > 0 ? ' damaged' : '')}>
            {pwr}/{tuf - inst.damage}
          </span>
        )}
        {inst.summoningSick && isCreature && <span className="badge sick" title="Summoning sick">zZ</span>}
      </div>
    </div>
  );
}
