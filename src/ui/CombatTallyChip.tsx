import type { CombatTally } from './combatTally';

// The combined damage readout under the combat prompt. Attacking: what the chosen attackers could deal
// to the enemy. Defending: what is coming, what your planned blocks stop, and what you will take.
export function CombatTallyChip({ t }: { t: CombatTally }) {
  const after = Math.max(0, t.after);
  if (t.mode === 'attack') {
    return (
      <div className={'tally attack' + (t.lethal ? ' lethal' : '')} role="status">
        <span className="tally-cell">
          <small>Attack</small>
          <b>⚔ {t.total}</b>
        </span>
        <span className="tally-sub">
          Enemy {t.life} → {after}
        </span>
        {t.lethal && <span className="tally-flag">Lethal if unblocked</span>}
      </div>
    );
  }
  return (
    <div className={'tally defend' + (t.lethal ? ' lethal' : t.taking > 0 ? ' hurt' : ' safe')} role="status">
      <span className="tally-cell">
        <small>Incoming</small>
        <b>⚔ {t.total}</b>
      </span>
      <span className="tally-cell blocked">
        <small>Blocked</small>
        <b>🛡 −{t.blocked}</b>
      </span>
      <span className="tally-cell take">
        <small>You take</small>
        <b>♥ −{t.taking}</b>
      </span>
      <span className="tally-sub">
        Life {t.life} → {after}
      </span>
      {t.lethal && <span className="tally-flag">Lethal — block more!</span>}
    </div>
  );
}
