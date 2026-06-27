// Starter decks: lists of CardDef ids. 30 cards each, ~12 lands.
// Both sides can use the same list for MVP; two flavors provided.

function repeat(id: string, n: number): string[] {
  return Array.from({ length: n }, () => id);
}

export const DECK_EMBERWOOD: string[] = [
  ...repeat('aether_well', 12),
  ...repeat('ember_sprite', 2),
  ...repeat('swift_lancer', 3),
  ...repeat('stoneback_cub', 3),
  ...repeat('thornwood_brute', 3),
  ...repeat('dread_maw', 2),
  ...repeat('cinderbolt', 3),
  ...repeat('scorch', 1),
  ...repeat('wild_growth', 1),
]; // 30

export const DECK_SKYWARD: string[] = [
  ...repeat('aether_well', 12),
  ...repeat('stoneback_cub', 3),
  ...repeat('sky_talon', 3),
  ...repeat('granite_sentinel', 3),
  ...repeat('storm_drake', 2),
  ...repeat('dread_maw', 1),
  ...repeat('cinderbolt', 2),
  ...repeat('insight', 2),
  ...repeat('scorch', 2),
]; // 30

export const STARTER_DECKS: Record<string, string[]> = {
  Emberwood: DECK_EMBERWOOD,
  Skyward: DECK_SKYWARD,
};
