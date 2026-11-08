import { useMemo, useState } from 'react';
import { CARDS, getDef } from '../cards/cards';
import { DECK_LIST } from '../cards/decks';
import {
  DECK_SIZE,
  MAX_COPIES,
  deleteCustomDeck,
  loadCustomDecks,
  deckableCards,
  newCustomId,
  saveCustomDeck,
  validateDeck,
  type CustomDeck,
} from '../cards/customDecks';
import type { CardDef, CardType } from '../engine/types';
import { CardFace } from './CardFace';

// Build and edit custom 30-card decks. Cards are already pure data, so this is
// UI only — nothing in the engine knows a deck was hand-built.
//
// Two views in one screen: a shelf of saved decks, and the editor. Starting from
// a copy of a starter deck matters more than it looks: an empty 30-card grid is
// a blank page, and every starter is a legal custom deck by construction (the
// copy limit is set to the densest one), so cloning always lands somewhere legal.

type Filter = 'all' | CardType;
const TYPE_FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'creature', label: 'Creatures' },
  { key: 'sorcery', label: 'Sorceries' },
  { key: 'instant', label: 'Instants' },
  { key: 'land', label: 'Lands' },
];
const TYPE_ORDER: Record<CardType, number> = { creature: 0, sorcery: 1, instant: 2, land: 3 };

const byBinderOrder = (a: CardDef, b: CardDef) =>
  TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.cost - b.cost || a.name.localeCompare(b.name);

export function DeckBuilder({ onBack }: { onBack: () => void }) {
  const [saved, setSaved] = useState<CustomDeck[]>(() => loadCustomDecks());
  const [draft, setDraft] = useState<CustomDeck | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Tokens are made by effects, never drawn, so they are not offered here.
  const pool = useMemo(() => deckableCards().sort(byBinderOrder), []);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter(
      (d) =>
        (filter === 'all' || d.type === filter) &&
        (!needle || d.name.toLowerCase().includes(needle) || (d.text ?? '').toLowerCase().includes(needle)),
    );
  }, [pool, q, filter]);

  // Counts drive both the "x6" badges in the pool and the deck list itself.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of draft?.cards ?? []) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [draft]);

  const issues = draft ? validateDeck(draft.name, draft.cards) : [];

  function startNew() {
    setDraft({ id: newCustomId(), name: '', cards: [] });
  }

  function cloneStarter(id: string) {
    const d = DECK_LIST.find((x) => x.id === id);
    if (!d) return;
    setDraft({ id: newCustomId(), name: `${d.name} (copy)`, cards: [...d.cards] });
  }

  function add(id: string) {
    setDraft((d) => {
      if (!d) return d;
      const def = CARDS[id];
      const have = d.cards.filter((c) => c === id).length;
      // Enforce the same rules validateDeck checks, so the UI can't build an
      // illegal deck in the first place rather than only complaining afterwards.
      if (d.cards.length >= DECK_SIZE) return d;
      if (def.type !== 'land' && have >= MAX_COPIES) return d;
      return { ...d, cards: [...d.cards, id] };
    });
  }

  function remove(id: string) {
    setDraft((d) => {
      if (!d) return d;
      const at = d.cards.lastIndexOf(id);
      if (at === -1) return d;
      const cards = [...d.cards];
      cards.splice(at, 1);
      return { ...d, cards };
    });
  }

  function save() {
    if (!draft || issues.length) return;
    saveCustomDeck(draft);
    setSaved(loadCustomDecks());
    setDraft(null);
  }

  function destroy(id: string) {
    deleteCustomDeck(id);
    setSaved(loadCustomDecks());
    if (draft?.id === id) setDraft(null);
  }

  // ---- shelf: pick a deck to edit, or start one ----
  if (!draft) {
    return (
      <div className="gallery">
        <div className="home-bg" aria-hidden />
        <header className="gallery-bar">
          <div className="gallery-top">
            <button className="book-btn gallery-back" onClick={onBack}>
              ← Back
            </button>
            <h2 className="gallery-title">Deck Builder</h2>
            <div className="gallery-search-wrap" />
          </div>
        </header>

        <div className="db-shelf">
          <p className="db-note">
            Custom decks work in <strong>Play vs AI</strong> and <strong>Hotseat</strong>. Online PvP
            uses the starter decks, because both players have to build the same deck from the same id.
          </p>

          <div className="db-row">
            <button className="db-new" onClick={startNew}>
              + New deck
            </button>
            {saved.map((d) => (
              <div className="db-saved" key={d.id}>
                <button className="db-saved-open" onClick={() => setDraft({ ...d, cards: [...d.cards] })}>
                  <span className="db-saved-name">{d.name}</span>
                  <span className="db-saved-sub">{d.cards.length} cards</span>
                </button>
                <button
                  className="db-del"
                  onClick={() => destroy(d.id)}
                  aria-label={`Delete deck ${d.name}`}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <h3 className="db-h3">Start from a starter deck</h3>
          <div className="db-row">
            {DECK_LIST.map((d) => (
              <button className="db-clone" key={d.id} onClick={() => cloneStarter(d.id)}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- editor ----
  const deckRows = [...counts.entries()].sort(([a], [b]) => byBinderOrder(getDef(a), getDef(b)));

  return (
    <div className="gallery">
      <div className="home-bg" aria-hidden />
      <header className="gallery-bar">
        <div className="gallery-top">
          <button className="book-btn gallery-back" onClick={() => setDraft(null)}>
            ← Decks
          </button>
          <input
            className="db-name"
            value={draft.name}
            placeholder="Deck name"
            aria-label="Deck name"
            maxLength={28}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="gallery-search-wrap">
            <input
              className="gallery-search"
              placeholder="Search cards…"
              aria-label="Search cards"
              value={q}
              onChange={(e) => setQ(e.target.value)}
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
            </button>
          ))}
          <span className={'db-count' + (draft.cards.length === DECK_SIZE ? ' ok' : '')}>
            {draft.cards.length}/{DECK_SIZE}
          </span>
          <button className="db-save" onClick={save} disabled={issues.length > 0}>
            Save deck
          </button>
        </div>
      </header>

      {issues.length > 0 && (
        <ul className="db-issues" aria-live="polite">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}

      <div className="db-body">
        <div className="db-pool">
          {visible.map((def) => {
            const have = counts.get(def.id) ?? 0;
            const full =
              draft.cards.length >= DECK_SIZE || (def.type !== 'land' && have >= MAX_COPIES);
            return (
              <button
                key={def.id}
                className={'card card-' + def.type + ' db-pick' + (full ? ' full' : '')}
                onClick={() => add(def.id)}
                disabled={full}
                aria-label={`Add ${def.name}${have ? `, ${have} in deck` : ''}`}
                title={full ? 'At the limit' : `Add ${def.name}`}
              >
                <CardFace def={def} />
                {have > 0 && <span className="db-have" aria-hidden>×{have}</span>}
              </button>
            );
          })}
        </div>

        <aside className="db-list" aria-label="Cards in this deck">
          {deckRows.length === 0 && <p className="db-empty">Click cards to add them.</p>}
          {deckRows.map(([id, n]) => {
            const def = getDef(id);
            return (
              <div className={'db-line ' + def.type} key={id}>
                <span className="db-n">{n}</span>
                <span className="db-nm">{def.name}</span>
                {def.type !== 'land' && <span className="db-cost">{def.cost}</span>}
                <button className="db-minus" onClick={() => remove(id)} aria-label={`Remove one ${def.name}`}>
                  −
                </button>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
