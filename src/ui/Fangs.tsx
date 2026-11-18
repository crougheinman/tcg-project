// Blitz mark: four white fangs set into the inner corners of the card, glowing red.
// Pure CSS positioning (.fangs / .fang in index.css) so it works on hand cards, board
// creatures and the big preview alike. Click-through, hidden from assistive tech.
const TOOTH = 'M2 0 C 22 2 30 24 19 56 C 21 36 12 19 2 11 Z';

export function Fangs() {
  return (
    <span className="fangs" aria-hidden>
      {['tl', 'tr', 'bl', 'br'].map((p) => (
        <i key={p} className={'fang ' + p}>
          <svg viewBox="0 0 30 56">
            <path d={TOOTH} />
          </svg>
        </i>
      ))}
    </span>
  );
}
