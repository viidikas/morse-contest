// Session content. Everything is generated from a numeric seed so the server
// can recreate exactly what was sent.

export type Rng = () => number;

/** Small deterministic random generator (mulberry32). Returns values in [0, 1). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GroupOptions {
  count: number;
  groupLength?: number;
  /**
   * How many times more likely the most recently learned character is than
   * the others. 1 = all equal. Helps a new Koch character get enough practice.
   */
  newestWeight?: number;
}

/** Random groups drawn from `chars` (the last character counts as the newest). */
export function randomGroups(rng: Rng, chars: string, opts: GroupOptions): string[] {
  const pool = [...chars];
  if (pool.length === 0) throw new Error('No characters to draw from');
  const len = opts.groupLength ?? 5;
  const weight = Math.max(1, opts.newestWeight ?? 1);
  const total = pool.length - 1 + weight;
  const pick = () => {
    const r = rng() * total;
    return r >= pool.length - 1 ? pool[pool.length - 1] : pool[Math.floor(r)];
  };
  const groups: string[] = [];
  for (let g = 0; g < opts.count; g++) {
    let s = '';
    for (let i = 0; i < len; i++) s += pick();
    groups.push(s);
  }
  return groups;
}

/**
 * Groups in which every character of `chars` appears exactly `repeats` times,
 * in random order. Used for qualification tests, where each character must be
 * tested. If the total does not divide into whole groups, the last group is
 * filled with random characters.
 */
export function coverageGroups(rng: Rng, chars: string, repeats: number, groupLength: number = 5): string[] {
  const set = [...chars];
  if (set.length === 0) throw new Error('No characters to draw from');
  const pool: string[] = [];
  for (let r = 0; r < repeats; r++) pool.push(...set);
  while (pool.length % groupLength !== 0) pool.push(set[Math.floor(rng() * set.length)]);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const groups: string[] = [];
  for (let i = 0; i < pool.length; i += groupLength) groups.push(pool.slice(i, i + groupLength).join(''));
  return groups;
}
