// The first-strike finisher: the screen blacks out and three quick energy slashes cut across it,
// cyan when the first striker is yours and red when it is theirs. (The floating card and the
// "First Strike!" label before it are the ordinary cast spotlight; BoardFx sequences the two.)
// Pure CSS, click-through, hidden from assistive tech. See .fs-* in index.css for the timeline.

// A crescent blade of light: a coloured body with a thinner white core, tapered at both ends.
function Blade() {
  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden>
      <path className="fs-body" d="M0 46 C 80 -10 320 -10 400 46 C 320 24 80 24 0 46 Z" />
      <path className="fs-core" d="M20 46 C 100 8 300 8 380 46 C 300 32 100 32 20 46 Z" />
    </svg>
  );
}

export function FirstStrikeFx({ side }: { side: 'me' | 'foe' }) {
  return (
    <div className={'fs-black ' + side} aria-hidden>
      {[1, 2, 3].map((n) => (
        <div key={n} className={'fs-slash s' + n}>
          <Blade />
        </div>
      ))}
      <i className="fs-flash" />
    </div>
  );
}
