import { beforeEach, describe, expect, it } from 'vitest';
import { defaultDepth, readDepth, saveDepth } from '../depth';

describe('3D table default', () => {
  it('is on for an ordinary device', () => {
    expect(defaultDepth({ reducedMotion: false, deviceMemory: 8, cores: 8 })).toBe(true);
  });

  it('is on when the browser reports nothing about the hardware', () => {
    // Safari and Firefox expose no deviceMemory; absence must not read as "weak".
    expect(defaultDepth({ reducedMotion: false })).toBe(true);
  });

  it('is off for someone who asked for reduced motion', () => {
    expect(defaultDepth({ reducedMotion: true, deviceMemory: 8, cores: 8 })).toBe(false);
  });

  it('is off on a low-memory or two-core device', () => {
    expect(defaultDepth({ reducedMotion: false, deviceMemory: 2, cores: 8 })).toBe(false);
    expect(defaultDepth({ reducedMotion: false, deviceMemory: 8, cores: 2 })).toBe(false);
  });
});

describe('3D table choice', () => {
  beforeEach(() => localStorage.clear());

  it('an explicit choice wins over the default, both ways, and persists', () => {
    saveDepth(false);
    expect(readDepth()).toBe(false);
    saveDepth(true);
    expect(readDepth()).toBe(true);
    expect(localStorage.getItem('depth')).toBe('1');
  });

  it('falls back to the default when nothing is saved (and survives no matchMedia)', () => {
    // jsdom has no matchMedia at all, which is exactly the case being guarded.
    expect(() => readDepth()).not.toThrow();
    expect(typeof readDepth()).toBe('boolean');
  });
});
