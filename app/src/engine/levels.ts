// The rooms people can join, from easiest to hardest. Shared by the server
// (which enforces the rules) and the browser (which displays them).

import { kochChars } from './morse.js';

export type LevelId = 'beginner' | 'mid' | 'advanced';

export interface LevelDef {
  id: LevelId;
  /** Number of characters, taken from the start of the Koch order. */
  charCount: number;
  charWpm: number;
  effWpm: number;
  /** Whether a solo qualification test must be passed before joining. */
  requiresTest: boolean;
}

export const LEVELS: readonly LevelDef[] = [
  { id: 'beginner', charCount: 10, charWpm: 20, effWpm: 8, requiresTest: false },
  { id: 'mid', charCount: 20, charWpm: 20, effWpm: 12, requiresTest: true },
  { id: 'advanced', charCount: 41, charWpm: 20, effWpm: 18, requiresTest: true },
];

/** Share of characters that must be copied correctly to pass a qualification test. */
export const PASS_ACCURACY = 0.75;

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

/** Position in the ladder; a pass for a harder level also opens the easier ones. */
export function levelRank(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}

export function levelChars(level: LevelDef): string {
  return kochChars(level.charCount);
}

/**
 * How many times each character appears in a qualification test: about 100
 * characters in total, and never fewer than 3 of each.
 */
export function testRepeats(level: LevelDef): number {
  return Math.max(3, Math.round(100 / level.charCount));
}
