import { useRef } from 'react';
import { motion } from 'framer-motion';
import { getDef } from '../cards/cards';
import { power, toughness } from '../engine/rules';
import type { CardInstance } from '../engine/types';
import { useSetHover } from './hover';
import { artFallback } from './artFallback';
import { Lightning } from './Lightning';
import { useGame } from '../store/gameStore';

// A Zombie token (Grave Necromancer's trigger, Raise Horde, Rotting Hulk's last breath) does not slam down like
// other creatures: it claws up out of the ground. Purely visual and per card, so several rise at once without
// waiting on each other or on the game. `isRising` is true for the first RISE_MS after a token is first drawn
// (and only that long, so a re-render or a hotseat flip never replays it); the table resets with each new game.
const RISE_MS = 2500;
const RISE_CLODS = [
  { x: '-26px', y: '-22px', s: 5, d: 0 },
  { x: '-12px', y: '-34px', s: 4, d: 40 },
  { x: '4px', y: '-28px', s: 6, d: 10 },
  { x: '18px', y: '-36px', s: 4, d: 70 },
  { x: '30px', y: '-20px', s: 5, d: 30 },
  { x: '-34px', y: '-10px', s: 3, d: 90 },
  { x: '38px', y: '-8px', s: 3, d: 60 },
];
let riseSeed: number | undefined;
const firstSeen = new Map<string, number>();
function isRising(iid: string, seed: number | undefined): boolean {
  if (seed !== riseSeed) {
    riseSeed = seed;
    firstSeen.clear();
  }
  const now = Date.now();
  const t = firstSeen.get(iid) ?? now;
  firstSeen.set(iid, t);
  return now - t < RISE_MS;
}

const LONG_PRESS_MS = 320;

// Mobile: a tap fires a synthetic mouseenter right before click, which used to pop
// the big preview over the board on every tap. Track the last touch so those
// synthetic hovers are ignored — on touch, ONLY a long-press opens the preview.
let lastTouchTs = 0;

/**
 * Did this focus come from the keyboard?
 *
 * A touch or mouse press focuses the card too, and on some browsers that focus
 * lands AFTER touchend — i.e. after `endPress` has already dismissed the
 * preview — which leaves the card revealed on a plain tap. `:focus-visible` is
 * the browser's own answer to "should this focus be shown", so it separates a
 * keyboard tab from a finger without us guessing at event order.
 *
 * Falls back to false where the selector is unsupported: a very old browser
 * loses preview-on-tab, which is far better than every tap popping a card.
 */
function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

interface Props {
  inst: CardInstance;
  faceDown?: boolean;
  selected?: boolean;
  targetable?: boolean;
  greenGlow?: boolean; // castable instant during the block step — pulses green
  dim?: boolean;
  arena?: boolean; // battlefield creature: image-only + floating P/T
  draggable?: boolean; // hand card: drag onto the battlefield to play it; ready creature: drag onto the enemy board to attack
  onDrop?: (point: { x: number; y: number }) => void;
  onDragChange?: (active: boolean) => void;
  onClick?: () => void;
}

// Framer Motion owns transform (scale/rotate/y) so it can animate enter, exit,
// reorder, tap, and hover. CSS keeps colors, borders, glows (non-transform).
const spring = { type: 'spring' as const, stiffness: 500, damping: 32 };

/**
 * Activating a card usually removes it from the DOM (played, destroyed), which
 * drops focus to <body> — so a keyboard player would have to tab from the top of
 * the page again after every single play. Hand focus back to the zone the card
 * lived in. Checked twice because framer keeps the node mounted, and focused,
 * until its exit animation finishes.
 */
function restoreFocusLater(from: HTMLElement): void {
  const zone = from.closest('[data-focus-zone]') as HTMLElement | null;
  if (!zone) return;
  let tries = 0;
  const tick = () => {
    // framer keeps the node mounted — and focused — for the length of its exit
    // animation, whose spring settles at no fixed time, so poll until the card
    // is really detached rather than guessing a delay.
    if (document.contains(from)) {
      if (++tries < 90) requestAnimationFrame(tick); // ~1.5s cap, then give up
      return;
    }
    const a = document.activeElement;
    if (!a || a === document.body) zone.focus(); // only if focus actually dropped
  };
  requestAnimationFrame(tick);
}

export function CardView({
  inst,
  faceDown,
  selected,
  targetable,
  greenGlow,
  dim,
  arena,
  draggable,
  onDrop,
  onDragChange,
  onClick,
}: Props) {
  const setHover = useSetHover();
  const seed = useGame((s) => s.game?.seed);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const didDrag = useRef(false);

  // Touch: hold to preview; a long-press suppresses the tap-to-play that follows.
  function onTouchStart() {
    lastTouchTs = Date.now();
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setHover(inst);
    }, LONG_PRESS_MS);
  }
  function endPress() {
    // Re-stamp on the way out. The synthetic mouse events a touch generates
    // arrive AFTER touchend, so the suppression window has to be measured from
    // the END of the touch, not its start — otherwise any press held longer
    // than the window lets the synthetic mouseenter through, which re-opens the
    // preview that releasing just dismissed and leaves it stuck on screen.
    lastTouchTs = Date.now();
    clearTimeout(pressTimer.current);
    setHover(null); // finger lifted -> always dismiss the preview (drag or long-press)
  }
  // Keyboard path. Cards are the primary game interaction and were pointer-only,
  // so the whole game was unreachable without a mouse. Enter/Space activate;
  // preventDefault stops Space from scrolling the board away under the player.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const from = e.currentTarget as HTMLElement;
    onClick?.(); // not handleClick: touch/drag guards are meaningless for keys
    restoreFocusLater(from);
  }

  function handleClick() {
    if (longPressed.current) {
      longPressed.current = false; // consumed by the long-press preview
      return;
    }
    if (didDrag.current) return; // consumed by a drag gesture
    onClick?.();
  }

  if (faceDown) {
    return (
      <motion.div
        className="card card-back"
        role="img"
        aria-label="Face-down card"
        layout
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.6 }}
        transition={spring}
      />
    );
  }
  const def = getDef(inst.def);
  const cls = [
    'card',
    `card-${def.type}`,
    inst.tapped ? 'tapped' : '',
    inst.blitz ? 'blitzed' : '',
    selected ? 'selected' : '',
    targetable ? 'targetable' : '',
    greenGlow ? 'green-glow' : '',
    dim ? 'dim' : '',
    onClick ? 'clickable' : '',
    draggable ? 'can-drag' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isCreature = def.type === 'creature';
  const pwr = power(inst);
  const tuf = toughness(inst);
  const titleText =
    def.type === 'land'
      ? `${def.name} — Land. Tap for 1 mana.`
      : `${def.name} — ${def.type}, cost ${def.cost}` +
        (isCreature ? `, ${pwr}/${tuf}` : '') +
        (def.text ? `. ${def.text}` : '');
  const arenaToken = arena && isCreature;
  const rising = !!arenaToken && inst.def === 'zombie_token' && isRising(inst.iid, seed);
  // a little stagger per card, so tokens raised together do not move in lockstep
  const riseDelay = `${250 + (inst.iid.charCodeAt(inst.iid.length - 1) % 4) * 110}ms`;
  const finalCls = (arenaToken ? cls + ' arena' : cls) + (rising ? ' rising' : '');
  const interactive = !!onClick;
  // The same sentence the mouse user gets as a tooltip, plus the state a sighted
  // player reads off the card's glow.
  const label =
    titleText +
    (inst.tapped ? '. Tapped' : '') +
    (targetable ? '. Targetable' : '') +
    (selected ? '. Selected' : '');

  return (
    <motion.div
      className={finalCls}
      data-iid={inst.iid}
      onClick={handleClick}
      role={interactive ? 'button' : 'img'}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      aria-pressed={interactive && selected ? true : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      style={rising ? ({ '--rise-delay': riseDelay } as React.CSSProperties) : undefined}
      // Keyboard focus surfaces the same big preview that hovering does — but
      // ONLY keyboard focus. See isKeyboardFocus: a tap focuses the card as well.
      onFocus={(e) => {
        if (isKeyboardFocus(e.currentTarget)) setHover(inst);
      }}
      onBlur={() => setHover(null)}
      // Android fires contextmenu on a long press, which would fight the
      // hold-to-preview gesture with the browser's own menu.
      onContextMenu={(e) => e.preventDefault()}
      // suppress the synthetic hover a touch tap generates — see lastTouchTs above
      onMouseEnter={() => {
        if (Date.now() - lastTouchTs < 700) return;
        setHover(inst);
      }}
      onMouseLeave={() => setHover(null)}
      onTouchStart={onTouchStart}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      onTouchMove={() => {
        lastTouchTs = Date.now(); // a drag is still touch input; keep hover suppressed
        clearTimeout(pressTimer.current);
      }}
      title={titleText}
      layout
      // Battlefield creatures SLAM down from above (MTG Arena thunk); hand cards
      // slide in from the deck side. Taps snap fast instead of springing.
      initial={
        rising
          ? { opacity: 1, scale: 1, y: 0 } // no slam: the CSS rise reveals it from the ground up
          : arenaToken
            ? { opacity: 0, scale: 1.55, y: -30 }
            : { opacity: 0, scale: 0.7, x: 48 }
      }
      animate={{ opacity: 1, scale: 1, x: 0, y: 0, rotate: inst.tapped ? 90 : 0 }}
      // A creature killed in combat (Board hands the AnimatePresence its impact delays as `custom`) keeps
      // its face until the stack around it fades it out after the hit -> crack -> pulverize; every other
      // card shrinks away at once.
      variants={{
        out: (delays?: Record<string, number>) =>
          delays?.[inst.iid] ? { opacity: 1, transition: { duration: 0 } } : { opacity: 0, scale: 0.5 },
      }}
      exit="out"
      whileHover={onClick && !draggable ? { y: -6 } : undefined}
      drag={draggable}
      dragSnapToOrigin
      dragElastic={0.25}
      whileDrag={{ scale: 1.08, zIndex: 80, cursor: 'grabbing' }}
      onDragStart={() => {
        didDrag.current = true;
        clearTimeout(pressTimer.current);
        if (!arena) setHover(inst); // a battlefield creature is dragged at the enemy: the preview would cover the target
        onDragChange?.(true);
      }}
      onDragEnd={(_e, info) => {
        setHover(null);
        onDragChange?.(false);
        onDrop?.(info.point);
        setTimeout(() => {
          didDrag.current = false;
        }, 0);
      }}
      transition={
        arenaToken
          ? { type: 'spring', stiffness: 640, damping: 34, rotate: { duration: 0.18, ease: 'easeOut' } }
          : { ...spring, rotate: { duration: 0.18, ease: 'easeOut' } }
      }
    >
      {arenaToken ? (
        <>
          {rising && (
            <span className="rise-ground" aria-hidden>
              <span className="rise-mound" />
              {RISE_CLODS.map((c, i) => (
                <i
                  key={i}
                  style={{ '--cx': c.x, '--cy': c.y, '--cs': `${c.s}px`, '--cd': `${c.d}ms` } as React.CSSProperties}
                />
              ))}
            </span>
          )}
          {def.art && (
            <img className="arena-art" src={def.art} alt="" draggable={false} onError={artFallback} />
          )}
          {(inst.buffP > 0 || inst.buffT > 0 || (inst.tempP ?? 0) > 0 || (inst.tempT ?? 0) > 0) && (
            <motion.div
              className="buff-crown"
              title="Buffed"
              initial={{ opacity: 0, y: 8, scale: 0.5 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18 }}
            >
              <span className="crown-glyph" aria-hidden>
                👑
              </span>
              <span className="buff-eye" aria-hidden />
            </motion.div>
          )}
          {inst.blitz && <Lightning />}
          <div className={'arena-pt' + (inst.damage > 0 ? ' damaged' : '')}>
            <span>
              {pwr}/{tuf - inst.damage}
            </span>
          </div>
          {inst.summoningSick && (
            <span className="sleep-zzz" title="Summoning sick — resting, can't attack yet" aria-hidden>
              <span>z</span>
              <span>z</span>
              <span>z</span>
            </span>
          )}
        </>
      ) : (
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
          {inst.blitz && isCreature && <Lightning />}
          <div className="card-bottom">
            {isCreature && (
              <span className={'card-pt' + (inst.damage > 0 ? ' damaged' : '')}>
                {pwr}/{tuf - inst.damage}
              </span>
            )}
            {inst.summoningSick && isCreature && (
              <span className="badge sick" title="Summoning sick">
                zZ
              </span>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
