import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { KEYWORD_INFO } from '../cards/keywords';
import { CHAPTERS, PAGES, chapterById, pagesOf, type Block, type Page } from '../rulebook/content';
import { markRuns, queryTerms, searchPages, stepIndex } from '../rulebook/search';

// The Field Manual (what used to be the plain "Rulebook"). Reusable: it renders its own book button and the book
// overlay. Chapters are the rotated side tabs; every chapter is a handful of pages with prev / next; the header
// search finds a page by any word. The words live in `src/rulebook/content.ts`, the search and paging maths in
// `src/rulebook/search.ts`; this file only lays them out.

export const MANUAL_NAME = 'Field Manual';

function Marked({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {markRuns(text, terms).map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>))}
    </>
  );
}

function Blocks({ blocks, terms }: { blocks: readonly Block[]; terms: readonly string[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'p':
            return (
              <p key={i}>
                <Marked text={b.text} terms={terms} />
              </p>
            );
          case 'list':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Marked text={it} terms={terms} />
                  </li>
                ))}
              </ul>
            );
          case 'note':
            return (
              <aside key={i} className="fm-note">
                {b.title && <b>{b.title}</b>}
                <Marked text={b.text} terms={terms} />
              </aside>
            );
          case 'keywords':
            return (
              <dl key={i} className="fm-kw">
                {b.keys.map((k) => (
                  <div key={k}>
                    <dt>
                      <Marked text={KEYWORD_INFO[k].label} terms={terms} />
                    </dt>
                    <dd>
                      <Marked text={KEYWORD_INFO[k].rule} terms={terms} />
                    </dd>
                  </div>
                ))}
              </dl>
            );
        }
      })}
    </>
  );
}

const FOCUSABLE = 'button:not(:disabled), input, a[href], [tabindex]:not([tabindex="-1"])';

export function Rulebook({
  label = true,
  icon = true,
  trigger = true,
  open: openProp,
  onOpenChange,
  page: startPage,
}: {
  label?: boolean;
  icon?: boolean; // render the 📖 glyph
  trigger?: boolean; // render the 📖 button (false = controlled externally)
  open?: boolean; // controlled open state
  onOpenChange?: (v: boolean) => void;
  page?: string; // page id to open at (default: the first page)
}) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => (controlled ? onOpenChange?.(v) : setOpenState(v));
  return (
    <>
      {trigger && (
        <button className="book-btn" onClick={() => setOpen(true)} title={MANUAL_NAME} aria-label={`Open ${MANUAL_NAME.toLowerCase()}`}>
          {icon && (
            <span className="book-ico" aria-hidden>
              📖
            </span>
          )}
          {label && <span>{MANUAL_NAME}</span>}
        </button>
      )}
      {/* In a portal on <body>: opened from the game's top bar, the book would sit inside the board's stacking context, and the phase
          banners and the Activity panel would paint over it. */}
      {createPortal(<AnimatePresence>{open && <Book key="book" onClose={() => setOpen(false)} startPage={startPage} />}</AnimatePresence>, document.body)}
    </>
  );
}

function Book({ onClose, startPage }: { onClose: () => void; startPage?: string }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(() => Math.max(0, PAGES.findIndex((p) => p.id === startPage)));
  const [dir, setDir] = useState<1 | -1>(1);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false); // the results list covers the page while true
  const dialogRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const page: Page = PAGES[index];
  const chapter = chapterById(page.chapter);
  const siblings = useMemo(() => pagesOf(page.chapter), [page.chapter]);
  const terms = useMemo(() => queryTerms(query), [query]);
  const hits = useMemo(() => searchPages(PAGES, query), [query]);

  const go = useCallback(
    (to: number) => {
      const next = Math.min(PAGES.length - 1, Math.max(0, to));
      setDir(next >= index ? 1 : -1);
      setIndex(next);
      setSearching(false);
    },
    [index],
  );
  const step = (d: 1 | -1) => go(stepIndex(PAGES.length, index, d));
  const goTo = (id: string) => {
    go(PAGES.findIndex((p) => p.id === id));
    dialogRef.current?.focus(); // the button that was clicked may be about to unmount (search results): keep the keys working
  };

  // A new page starts at its top.
  useEffect(() => {
    pageRef.current?.scrollTo?.({ top: 0 });
  }, [index]);

  // Take focus on open (so the keys work at once) and give it back to what opened the book on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const typing = (e.target as HTMLElement).tagName === 'INPUT';
    if (e.key === 'Escape') {
      e.stopPropagation();
      // Esc first backs out of an active search; with none on screen it closes the book (a query kept only for highlighting does not count).
      if (query && (searching || document.activeElement === searchRef.current)) {
        setQuery('');
        setSearching(false);
      } else onClose();
    } else if (e.key === 'ArrowRight' && !typing) {
      step(1);
    } else if (e.key === 'ArrowLeft' && !typing) {
      step(-1);
    } else if (e.key === '/' && !typing) {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === 'Tab') {
      // keep Tab inside the book
      const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const here = document.activeElement;
      if (e.shiftKey && (here === first || here === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Touch: a clear horizontal swipe turns the page.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const slide = reduce ? 0 : 26;

  return (
    <motion.div className="book-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="fm"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={MANUAL_NAME}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        initial={reduce ? { opacity: 0 } : { scaleY: 0.04, opacity: 0 }}
        animate={reduce ? { opacity: 1 } : { scaleY: 1, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { scaleY: 0.04, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
        style={{ transformOrigin: 'top', ['--fm-accent' as string]: chapter.color } as CSSProperties}
      >
        <header className="fm-head">
          <h2 className="fm-title">{MANUAL_NAME}</h2>
          <label className="fm-search">
            <span aria-hidden>⌕</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search"
              aria-label="Search the manual"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearching(true);
              }}
              onFocus={() => query && setSearching(true)}
            />
            {query ? (
              <button
                type="button"
                className="fm-clear"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  setSearching(false);
                  searchRef.current?.focus();
                }}
              >
                ✕
              </button>
            ) : (
              <kbd aria-hidden>/</kbd>
            )}
          </label>
          <button className="fm-close" onClick={onClose} aria-label={`Close ${MANUAL_NAME.toLowerCase()}`}>
            ✕
          </button>
        </header>

        <div className="fm-main">
          <div className="fm-book">
            <nav className="fm-aside" aria-label={`Pages in ${chapter.title}`}>
              <div className="fm-aside-head">
                <span className="fm-aside-ch">{chapter.title}</span>
                <span className="fm-aside-blurb">{chapter.blurb}</span>
              </div>
              <ol>
                {siblings.map((p) => (
                  <li key={p.id}>
                    <button className={p.id === page.id ? 'on' : ''} aria-current={p.id === page.id ? 'page' : undefined} onClick={() => goTo(p.id)}>
                      {p.title}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            <div
              className="fm-page"
              ref={pageRef}
              onTouchStart={(e) => {
                swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              }}
              onTouchEnd={(e) => {
                const s = swipe.current;
                swipe.current = null;
                if (!s) return;
                const dx = e.changedTouches[0].clientX - s.x;
                const dy = e.changedTouches[0].clientY - s.y;
                if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) step(dx < 0 ? 1 : -1);
              }}
            >
              <AnimatePresence mode="wait" initial={false} custom={dir}>
                <motion.article
                  key={page.id}
                  className="fm-article"
                  custom={dir}
                  variants={{
                    in: (d: number) => ({ opacity: 0, x: d * slide }),
                    show: { opacity: 1, x: 0 },
                    out: (d: number) => ({ opacity: 0, x: -d * slide }),
                  }}
                  initial="in"
                  animate="show"
                  exit="out"
                  transition={{ duration: 0.16 }}
                >
                  <p className="fm-kicker">
                    {chapter.title} · page {siblings.indexOf(page) + 1} of {siblings.length}
                  </p>
                  <h3 className="fm-h">
                    <Marked text={page.title} terms={terms} />
                  </h3>
                  <Blocks blocks={page.blocks} terms={terms} />
                </motion.article>
              </AnimatePresence>
            </div>

            {searching && query && (
              <div className="fm-results" role="region" aria-label="Search results" aria-live="polite">
                {hits.length === 0 ? (
                  <p className="fm-none">
                    Nothing found for <b>“{query}”</b>. Try a word from a card, like <i>flying</i>, <i>mulligan</i> or <i>kicker</i>.
                  </p>
                ) : (
                  <>
                    <p className="fm-count">
                      {hits.length} {hits.length === 1 ? 'page' : 'pages'}
                    </p>
                    <ul>
                      {hits.map(({ page: p, snippet }) => (
                        <li key={p.id}>
                          <button onClick={() => goTo(p.id)} style={{ ['--tab' as string]: chapterById(p.chapter).color } as CSSProperties}>
                            <span className="fm-hit-ch">{chapterById(p.chapter).tab}</span>
                            <span className="fm-hit-title">
                              <Marked text={p.title} terms={terms} />
                            </span>
                            <span className="fm-hit-snip">
                              {snippet.before}
                              {snippet.match && <mark>{snippet.match}</mark>}
                              {snippet.after}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="fm-tabs" role="tablist" aria-orientation="vertical" aria-label="Chapters">
            {CHAPTERS.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === page.chapter}
                className={c.id === page.chapter ? 'on' : ''}
                style={{ ['--tab' as string]: c.color } as CSSProperties}
                title={c.title}
                onClick={() => go(PAGES.findIndex((p) => p.chapter === c.id))}
              >
                <span>{c.tab}</span>
              </button>
            ))}
          </div>
        </div>

        <footer className="fm-foot">
          <button className="fm-nav" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous page">
            <span aria-hidden>‹</span>
            <span className="fm-nav-t">{index > 0 ? PAGES[index - 1].title : ''}</span>
          </button>
          <span className="fm-count-pill">
            {index + 1} / {PAGES.length}
          </span>
          <button className="fm-nav next" onClick={() => step(1)} disabled={index === PAGES.length - 1} aria-label="Next page">
            <span className="fm-nav-t">{index < PAGES.length - 1 ? PAGES[index + 1].title : ''}</span>
            <span aria-hidden>›</span>
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
