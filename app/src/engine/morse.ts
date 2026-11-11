// Morse alphabet and timing. Pure functions with no browser or Node
// dependencies, so the server and the browser compute identical timelines.

export const MORSE: Readonly<Record<string, string>> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
  V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-',
};

// Order in which characters are introduced (Koch method, the sequence used
// by LCWO). Level n means the first n characters; level 2 is the minimum.
export const KOCH_ORDER = 'KMURESNAPTLWI.JZ=FOY,VG5/Q92H38B?47C1D60X';

export function kochChars(level: number): string {
  const n = Math.max(2, Math.min(KOCH_ORDER.length, Math.floor(level)));
  return KOCH_ORDER.slice(0, n);
}

export interface Timing {
  ditMs: number;
  dahMs: number;
  /** Gap between the dits and dahs inside one character. */
  intraMs: number;
  /** Gap between characters. */
  charGapMs: number;
  /** Gap between words. */
  wordGapMs: number;
}

/**
 * Timing for characters sent at `charWpm` with overall speed `effectiveWpm`
 * (Farnsworth spacing). Based on the standard word PARIS = 50 dit units:
 * 31 units of sound-and-inner-gaps, 4 character gaps and 1 word gap. When the
 * effective speed is lower, only the character and word gaps are stretched,
 * in their usual 3:7 proportion.
 */
export function makeTiming(charWpm: number, effectiveWpm: number = charWpm): Timing {
  const c = Math.max(5, charWpm);
  const s = Math.max(1, Math.min(effectiveWpm, c));
  const ditMs = 1200 / c;
  let charGapMs = 3 * ditMs;
  let wordGapMs = 7 * ditMs;
  if (s < c) {
    const spareMs = 60000 / s - 31 * ditMs; // total gap time per PARIS word
    charGapMs = (3 * spareMs) / 19;
    wordGapMs = (7 * spareMs) / 19;
  }
  return { ditMs, dahMs: 3 * ditMs, intraMs: ditMs, charGapMs, wordGapMs };
}

export interface Tone {
  startMs: number;
  durMs: number;
}

export interface GroupSlot {
  index: number;
  text: string;
  /** When the first tone of the group starts. */
  startMs: number;
  /** When the last tone of the group ends. */
  audioEndMs: number;
  /** Answers for this group are accepted until this moment. */
  deadlineMs: number;
}

export interface Timeline {
  tones: Tone[];
  groups: GroupSlot[];
  totalMs: number;
}

/** Duration of one character's sound, from first tone on to last tone off. */
export function charDurationMs(ch: string, t: Timing): number {
  const code = MORSE[ch];
  if (!code) throw new Error(`No Morse code for "${ch}"`);
  let ms = 0;
  for (const el of code) ms += el === '.' ? t.ditMs : t.dahMs;
  return ms + (code.length - 1) * t.intraMs;
}

/**
 * Lays groups out on a timeline starting at 0. After each group there is a
 * pause of `groupGapMs` (never shorter than a normal word gap) for typing;
 * the answer deadline of a group is the start of the next one.
 */
export function buildTimeline(groups: string[], t: Timing, groupGapMs: number = 0): Timeline {
  const gap = Math.max(t.wordGapMs, groupGapMs);
  const tones: Tone[] = [];
  const slots: GroupSlot[] = [];
  let at = 0;
  groups.forEach((raw, index) => {
    const text = raw.toUpperCase();
    const startMs = at;
    [...text].forEach((ch, i) => {
      const code = MORSE[ch];
      if (!code) throw new Error(`No Morse code for "${ch}"`);
      if (i > 0) at += t.charGapMs;
      [...code].forEach((el, j) => {
        if (j > 0) at += t.intraMs;
        const durMs = el === '.' ? t.ditMs : t.dahMs;
        tones.push({ startMs: at, durMs });
        at += durMs;
      });
    });
    const audioEndMs = at;
    at += gap;
    slots.push({ index, text, startMs, audioEndMs, deadlineMs: at });
  });
  return { tones, groups: slots, totalMs: at };
}
