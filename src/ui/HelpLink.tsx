import type { HelpPageId } from '../rulebook/content';

// A small "?" that opens the Field Manual at the page about what the player is being asked to do (a Ninjutsu window, a Scry, a cast option...).
// It only opens the book: it never touches the game, so it is safe at any point, online play included.
export function HelpLink({ page, onOpen, label = 'How does this work?' }: { page: HelpPageId; onOpen: (page: HelpPageId) => void; label?: string }) {
  return (
    <button type="button" className="help-link" title={label} aria-label={label} onClick={() => onOpen(page)}>
      ?
    </button>
  );
}
