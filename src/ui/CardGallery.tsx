import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CARDS } from '../cards/cards';
import type { CardDef, CardType } from '../engine/types';

// A browsable codex of every card in the game: search + type filter, and a click
// to open a larger detail view with full rules text and flavor. Reuses the in-game
// `.card` face classes so gallery cards look exactly like the ones on the board.

type Filter = 'all' | CardType;

const TYPE_FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'creature', label: 'Creatures' },
  { key: 'sorcery', label: 'Sorceries' },
  { key: 'instant', label: 'Instants' },
  { key: 'land', label: 'Lands' },
];

// Group by type, then curve, then name — reads like a well-ordered binder.
const TYPE_ORDER: Record<CardType, number> = { creature: 0, sorcery: 1, instant: 2, land: 3 };

function artFallback(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.src.endsWith('.png')) img.src = img.src.replace(/\.png$/, '.svg');
  else img.style.display = 'none';
}

// The shared card face (name / cost / art / rules text / power-toughness).
function CardFace({ def }: { def: CardDef }) {
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

export function CardGallery({ onBack }: { onBack: () => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<CardDef | null>(null);

  const all = useMemo(() => Object.values(CARDS), []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const d of all) c[d.type] = (c[d.type] ?? 0) + 1;
    return c;
  }, [all]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((d) => (filter === 'all' ? true : d.type === filter))
      .filter((d) => {
        if (!needle) return true;
        return (
          d.name.toLowerCase().includes(needle) ||
          d.type.includes(needle) ||
          (d.text?.toLowerCase().includes(needle) ?? false) ||
          (d.flavor?.toLowerCase().includes(needle) ?? false) ||
          (d.keywords?.some((k) => k.includes(needle)) ?? false)
        );
      })
      .sort(
        (a, b) =>
          TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.cost - b.cost || a.name.localeCompare(b.name),
      );
  }, [all, q, filter]);

  return (
    <div className="gallery">
      <div className="home-bg" aria-hidden />

      <header className="gallery-bar">
        <div className="gallery-top">
          <button className="book-btn gallery-back" onClick={onBack}>
            ← Back
          </button>
          <h2 className="gallery-title">Card Codex</h2>
          <div className="gallery-search-wrap">
            <span className="gallery-search-ico" aria-hidden>
              ⌕
            </span>
            <input
              className="gallery-search"
              type="search"
              placeholder="Search name, ability, flavor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search cards"
            />
          </div>
        </div>

        <div className="gallery-filters" role="tablist" aria-label="Filter by type">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={filter === t.key}
              className={'gchip ' + (filter === t.key ? 'on ' : '') + t.key}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
              <span className="gchip-count">{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="gallery-scroll">
        {shown.length > 0 ? (
          <div className="gallery-grid">
            {shown.map((def) => (
              <div
                key={def.id}
                className={`card card-${def.type} gcard`}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(def)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(def);
                  }
                }}
              >
                <CardFace def={def} />
              </div>
            ))}
          </div>
        ) : (
          <div className="gallery-empty">
            <span className="gallery-empty-ico" aria-hidden>
              ⚑
            </span>
            No cards match “{q}”.
          </div>
        )}
        <p className="gallery-count">
          {shown.length} of {all.length} cards
        </p>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            className="gallery-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setSelected(null)}
          >
            <motion.div
              className="gallery-detail"
              initial={{ opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="gallery-detail-close"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                ×
              </button>
              <div className="gallery-detail-cardwrap">
                <div className={`card card-${selected.type} gcard gcard-big`}>
                  <CardFace def={selected} />
                </div>
              </div>
              <div className="gallery-detail-info">
                <h3>{selected.name}</h3>
                <div className="gallery-detail-meta">
                  <span className={'gchip on ' + selected.type}>{selected.type}</span>
                  {selected.type !== 'land' && <span className="meta-pill">◈ {selected.cost}</span>}
                  {selected.type === 'creature' && (
                    <span className="meta-pill">
                      {selected.power}/{selected.toughness}
                    </span>
                  )}
                  {selected.keywords?.map((k) => (
                    <span key={k} className="meta-pill key">
                      {k}
                    </span>
                  ))}
                  {selected.blockOnly && <span className="meta-pill key">block-only</span>}
                </div>
                {selected.text && <p className="gallery-detail-rules">{selected.text}</p>}
                {selected.flavor && <p className="gallery-detail-flavor">“{selected.flavor}”</p>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
