import { useState } from 'react';
import { motion } from 'framer-motion';
import type { CardDef } from '../engine/types';
import { effectText } from './effectText';
import { spellEffect } from '../engine/rules';

export interface CastOpts { x?: number; kicked?: boolean; mode?: number }

// Modal / kicker / X spells: choose the options before the target. Shows the total cost; the Cast button is off while it cannot be paid.
export function CastOptions({
  def,
  mana,
  onCast,
  onCancel,
}: {
  def: CardDef;
  mana: number;
  onCast: (o: CastOpts) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState(0);
  const [kicked, setKicked] = useState(false);
  const [x, setX] = useState(1);
  const kickCost = kicked && def.kicker ? def.kicker.cost : 0;
  const maxX = Math.max(0, mana - def.cost - kickCost);
  const xs = def.x ? Math.min(x, maxX) : 0;
  const total = def.cost + kickCost + xs;
  const opts: CastOpts = { ...(def.modes ? { mode } : {}), ...(kicked ? { kicked: true } : {}), ...(def.x ? { x: xs } : {}) };
  const eff = spellEffect(def, opts);
  const can = total <= mana;
  return (
    <div className="zone-overlay scry-overlay" role="dialog" aria-label={`Cast ${def.name}`}>
      <motion.div
        className="zone-modal scry-modal"
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <div className="zone-head">
          <span className="zone-title">{def.name}</span>
          <span className="zone-total">cost ◈ {total} of {mana}</span>
        </div>
        <div className="cast-opts">
          {def.modes && (
            <fieldset className="cast-group">
              <legend>Choose one</legend>
              {def.modes.map((m, i) => (
                <label key={i} className={'cast-choice' + (mode === i ? ' on' : '')}>
                  <input type="radio" name="mode" checked={mode === i} onChange={() => setMode(i)} />
                  <span>{effectText(m)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {def.x && (
            <div className="cast-group cast-x">
              <span>X</span>
              <button type="button" onClick={() => setX(Math.max(0, xs - 1))} disabled={xs <= 0} aria-label="Less">−</button>
              <b>{xs}</b>
              <button type="button" onClick={() => setX(Math.min(maxX, xs + 1))} disabled={xs >= maxX} aria-label="More">+</button>
            </div>
          )}
          {def.kicker && (
            <label className={'cast-choice' + (kicked ? ' on' : '')}>
              <input type="checkbox" checked={kicked} onChange={(e) => setKicked(e.target.checked)} disabled={def.cost + def.kicker.cost + (def.x ? 0 : 0) > mana} />
              <span>Kicker ◈{def.kicker.cost}: also {effectText(def.kicker.effect).toLowerCase().replace('to a player', 'to your opponent')}</span>
            </label>
          )}
          {eff && <p className="cast-preview">{effectText(eff)}{kicked && def.kicker ? ` · ${effectText(def.kicker.effect).replace('to a player', 'to your opponent')}` : ''}</p>}
          <div className="scry-actions">
            <button className="zone-flash" disabled={!can} onClick={() => onCast(opts)}>Cast</button>
            <button className="zone-flash scry-bottom" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
