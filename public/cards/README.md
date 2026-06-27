# Card art

Put card images here. A file at `public/cards/ember_sprite.png` is served at
`/cards/ember_sprite.png`.

Wire it to a card by setting `art` in `src/cards/cards.ts`:

```ts
ember_sprite: {
  id: 'ember_sprite',
  name: 'Ember Sprite',
  type: 'creature',
  cost: 1, power: 1, toughness: 1,
  keywords: ['haste'],
  text: 'Haste.',
  art: '/cards/ember_sprite.png',   // <- add this line
},
```

Cards without `art` keep the plain text frame — mix and match freely.

Recommended size: ~320×160 (2:1), PNG or WebP. Keep files small (<100 KB) so the
build stays lean.

## Free art sources

- AI image generators (your own prompts) — original, safe to ship
- Kenney.nl — CC0, no attribution
- OpenGameArt.org / itch.io — check each asset's license
- game-icons.net — CC-BY icons (credit required)

Do NOT use real Magic: The Gathering art — it's copyrighted.
```
