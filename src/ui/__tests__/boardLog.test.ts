import { describe, expect, it } from 'vitest';
import { humanize } from '../boardLog';

describe('humanize (the activity log from the local player\'s seat)', () => {
  it('turns A / B into You / Opponent with first-person verbs, including the newer ones', () => {
    expect(humanize('A sacrifices Ashigaru', 'A')).toBe('You sacrifice Ashigaru');
    expect(humanize('B sacrifices Ashigaru', 'A')).toBe('Opponent sacrifices Ashigaru');
    expect(humanize('A cycles Ancient Treant', 'A')).toBe('You cycle Ancient Treant');
    expect(humanize('A returns Ashigaru to hand', 'A')).toBe('You return Ashigaru to hand');
    expect(humanize('A discards Insight', 'A')).toBe('You discard Insight');
    expect(humanize('A has no creature to sacrifice', 'A')).toBe('You have no creature to sacrifice');
    expect(humanize('B has no creature to sacrifice', 'A')).toBe('Opponent has no creature to sacrifice');
  });
  it('keeps the old verbs working', () => {
    expect(humanize('A casts Cinderbolt', 'A')).toBe('You cast Cinderbolt');
    expect(humanize("B's turn", 'A')).toBe("Opponent's turn");
  });
});
