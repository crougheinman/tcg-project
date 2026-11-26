import type { ReactNode } from 'react';
import { CARDS } from '../cards/cards';
import { KEYWORD_INFO } from '../cards/keywords';
import type { FigureId } from '../rulebook/content';
import { BOARD_SHOTS } from '../rulebook/boardShot';
import { artFallback } from './artFallback';

// The Field Manual's figures. Each one is a live diagram built from real card data (the art, the names, the numbers all come
// from CARDS, so a rebalance or a new art file updates the manual by itself), except `board`, an annotated screenshot
// produced by tools/qa/manual-shots.cjs. Pure presentation: nothing here touches the game or the store.

type Side = 'me' | 'foe';

function FigCard({
  id,
  side,
  p,
  t,
  note,
  tone,
  kw,
  fade,
}: {
  id: string;
  side: Side;
  p?: number; // shown power / toughness (default: the printed ones)
  t?: number;
  note?: string; // a small caption under the card
  tone?: 'bad' | 'good';
  kw?: string; // a keyword the card has in this picture (printed or granted)
  fade?: boolean;
}) {
  const def = CARDS[id];
  const power = p ?? def.power;
  const tough = t ?? def.toughness;
  return (
    <figure className={`fg-card ${side}${fade ? ' fade' : ''}${tone ? ' ' + tone : ''}`}>
      <div className="fg-art">
        {def.art && <img src={def.art} alt="" draggable={false} onError={artFallback} />}
        {power !== undefined && (
          <span className={'fg-pt' + (p !== undefined || t !== undefined ? ' changed' : '')}>
            {power}/{tough}
          </span>
        )}
        {kw && <span className="fg-kw">{kw}</span>}
      </div>
      <figcaption>
        <b>{def.name}</b>
        {note && <span>{note}</span>}
      </figcaption>
    </figure>
  );
}

const Arrow = ({ children }: { children?: ReactNode }) => (
  <div className="fg-arrow" aria-hidden>
    <span>{children}</span>
    <svg viewBox="0 0 40 12" width="40" height="12">
      <path d="M0 6h34M28 1l8 5-8 5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  </div>
);
const Op = ({ children }: { children: ReactNode }) => (
  <div className="fg-op" aria-hidden>
    {children}
  </div>
);
const Row = ({ children, label }: { children: ReactNode; label?: string }) => (
  <div className="fg-row">
    {label && <div className="fg-label">{label}</div>}
    <div className="fg-line">{children}</div>
  </div>
);

const label = (k: keyof typeof KEYWORD_INFO) => KEYWORD_INFO[k].label;

function Turn() {
  const steps: { name: string; sub: string; who: 'me' | 'foe' | 'both'; auto?: boolean }[] = [
    { name: 'Untap + draw', sub: 'automatic', who: 'me', auto: true },
    { name: 'Main', sub: 'land, cast, abilities', who: 'me' },
    { name: 'Attack', sub: 'pick attackers', who: 'me' },
    { name: 'Block', sub: 'defender picks', who: 'foe' },
    { name: 'Damage', sub: 'automatic', who: 'both', auto: true },
    { name: 'End', sub: 'pass the turn', who: 'me' },
  ];
  return (
    <ol className="fg-turn">
      {steps.map((s) => (
        <li key={s.name} className={s.who + (s.auto ? ' auto' : '')}>
          <b>{s.name}</b>
          <span>{s.sub}</span>
        </li>
      ))}
    </ol>
  );
}

function Block() {
  return (
    <>
      <Row label="One blocker, one attacker">
        <FigCard id="swift_lancer" side="foe" note="attacks" />
        <Op>blocked by</Op>
        <FigCard id="stoneback_cub" side="me" note="blocks" />
      </Row>
      <Row label={`${label('flying')} needs ${label('flying')} or ${label('reach')}`}>
        <FigCard id="sky_talon" side="foe" note="attacks" />
        <Op>✕</Op>
        <FigCard id="ashigaru" side="me" note="cannot block it" fade />
        <Op>✓</Op>
        <FigCard id="granite_sentinel" side="me" note="can block it" kw={label('reach')} />
      </Row>
    </>
  );
}

function Damage() {
  const a = CARDS.swift_lancer;
  const b = CARDS.stoneback_cub;
  return (
    <Row>
      <FigCard id="swift_lancer" side="foe" tone="bad" note={`takes ${b.power}: destroyed`} />
      <Op>⇄</Op>
      <FigCard id="stoneback_cub" side="me" tone="bad" note={`takes ${a.power}: destroyed`} />
    </Row>
  );
}

function TwoStep() {
  return (
    <>
      <Row label={`Step 1: ${label('firstStrike')} damage`}>
        <FigCard id="kensei_duelist" side="foe" kw={label('firstStrike')} note={`deals ${CARDS.kensei_duelist.power}`} />
        <Arrow />
        <FigCard id="stoneback_cub" side="me" tone="bad" note="destroyed" />
      </Row>
      <Row label="Step 2: regular damage">
        <FigCard id="kensei_duelist" side="foe" note="takes nothing" />
        <Op>✕</Op>
        <FigCard id="stoneback_cub" side="me" fade note="never strikes back" />
      </Row>
    </>
  );
}

function Blitz() {
  const lance = CARDS.swift_lancer;
  const bonus = CARDS.kunoichi.static;
  const bp = bonus?.power ?? 1;
  const bt = bonus?.toughness ?? 1;
  return (
    <Row>
      <FigCard id="swift_lancer" side="me" note="alone" />
      <Op>+</Op>
      <FigCard id="kunoichi" side="me" note="in play" />
      <Arrow />
      <FigCard id="swift_lancer" side="me" p={(lance.power ?? 0) + bp} t={(lance.toughness ?? 0) + bt} note={`+${bp}/+${bt}`} tone="good" />
    </Row>
  );
}

function Equip() {
  const eq = CARDS.ronins_katana.equip!;
  const base = CARDS.ashigaru;
  return (
    <Row>
      <FigCard id="ashigaru" side="me" note="your creature" />
      <Op>+</Op>
      <FigCard id="ronins_katana" side="me" note={`Equip {${eq.cost}}`} />
      <Arrow />
      <FigCard id="ashigaru" side="me" p={(base.power ?? 0) + eq.power} t={(base.toughness ?? 0) + eq.toughness} kw={label('firstStrike')} note={`+${eq.power}/+${eq.toughness}`} tone="good" />
    </Row>
  );
}

function Ninjutsu() {
  const n = CARDS.kensei_duelist;
  return (
    <>
      <Row label="You attack and nobody blocks Ashigaru">
        <FigCard id="ashigaru" side="me" note="unblocked" />
        <Op>⇄</Op>
        <FigCard id="kensei_duelist" side="me" note={`in hand · Ninjutsu {${n.ninjutsu}}`} />
      </Row>
      <Row label="Swap: the ninja hits instead">
        <FigCard id="ashigaru" side="me" fade note="back to your hand" />
        <Arrow />
        <FigCard id="kensei_duelist" side="me" tone="good" note="tapped and attacking" />
      </Row>
    </>
  );
}

function BoardShot() {
  const shots = BOARD_SHOTS;
  return (
    <>
      {([['wide', shots.wide], ['narrow', shots.narrow]] as const).map(([k, shot]) =>
        shot.src ? (
          <div key={k} className={`fg-shot ${k}`}>
            <div className="fg-shot-img" style={{ aspectRatio: `${shot.w} / ${shot.h}` }}>
              <img src={shot.src} alt="The game board with numbered callouts" width={shot.w} height={shot.h} loading="lazy" />
              {shot.marks.map((m) => (
                <span key={m.n} className="fg-mark" style={{ left: `clamp(12px, ${(m.x / shot.w) * 100}%, calc(100% - 12px))`, top: `clamp(12px, ${(m.y / shot.h) * 100}%, calc(100% - 12px))` }} aria-hidden>
                  {m.n}
                </span>
              ))}
            </div>
            <ol className="fg-legend">
              {shot.marks.map((m) => (
                <li key={m.n} value={m.n}>
                  {m.label}
                </li>
              ))}
            </ol>
          </div>
        ) : null,
      )}
    </>
  );
}

const FIGURES: Record<FigureId, () => ReactNode> = {
  turn: Turn,
  block: Block,
  damage: Damage,
  twostep: TwoStep,
  blitz: Blitz,
  equip: Equip,
  ninjutsu: Ninjutsu,
  board: BoardShot,
};

export function ManualFigure({ id, caption, mark }: { id: FigureId; caption: ReactNode; mark?: boolean }) {
  const Body = FIGURES[id] as () => ReactNode;
  return (
    <figure className={`fg fg-${id}`} data-figure={id} data-marked={mark ? '' : undefined}>
      <div className="fg-body">
        <Body />
      </div>
      <figcaption className="fg-caption">{caption}</figcaption>
    </figure>
  );
}
