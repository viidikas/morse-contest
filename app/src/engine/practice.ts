// Analysis of a continuous practice session, where each group repeats until
// the listener has typed it. Besides right and wrong, the number of repeats
// a group needed shows which characters are still slow to recognise.

import { summarize, type GroupScore, type Summary } from './score.js';

export interface Attempt {
  score: GroupScore;
  /** How many times the group was played again before it was answered. */
  repeats: number;
  /** From the end of the first playing to the answer being complete. */
  answerMs: number;
}

export interface WeakChar {
  char: string;
  sent: number;
  correct: number;
  /** Groups containing this character that needed at least one repeat. */
  repeated: number;
  /** What it was typed as instead, most frequent first. */
  mixedWith: { typed: string; count: number }[];
}

export interface PracticeAnalysis {
  summary: Summary;
  groups: number;
  avgRepeats: number;
  avgAnswerMs: number;
  /** Characters to study more, the most troublesome first. */
  weak: WeakChar[];
  /** Groups that needed the most repeats, most first. Only groups with repeats. */
  hardest: Attempt[];
}

/** A character is weak below this share of correct copies... */
export const WEAK_ACCURACY = 0.9;
/** ...or when at least this share of its groups had to be repeated. */
export const WEAK_REPEAT_SHARE = 0.5;

export function analyzePractice(attempts: Attempt[]): PracticeAnalysis {
  const summary = summarize(attempts.map((a) => a.score));
  const repeated = new Map<string, number>();
  for (const a of attempts) {
    if (a.repeats === 0) continue;
    // Each character counts once per repeated group.
    for (const ch of new Set(a.score.ops.filter((o) => o.type !== 'extra').map((o) => o.sent))) {
      repeated.set(ch, (repeated.get(ch) ?? 0) + 1);
    }
  }
  const groupsWith = new Map<string, number>();
  for (const a of attempts) {
    for (const ch of new Set(a.score.ops.filter((o) => o.type !== 'extra').map((o) => o.sent))) {
      groupsWith.set(ch, (groupsWith.get(ch) ?? 0) + 1);
    }
  }

  const weak: (WeakChar & { badness: number })[] = [];
  for (const c of summary.chars) {
    const rep = repeated.get(c.char) ?? 0;
    const repShare = rep / (groupsWith.get(c.char) ?? 1);
    const acc = c.correct / c.sent;
    if (acc >= WEAK_ACCURACY && repShare < WEAK_REPEAT_SHARE) continue;
    weak.push({
      char: c.char,
      sent: c.sent,
      correct: c.correct,
      repeated: rep,
      mixedWith: summary.confusions.filter((x) => x.sent === c.char).map((x) => ({ typed: x.typed, count: x.count })),
      badness: (1 - acc) + repShare / 2,
    });
  }
  weak.sort((a, b) => b.badness - a.badness || b.sent - a.sent || a.char.localeCompare(b.char));

  const n = attempts.length;
  return {
    summary,
    groups: n,
    avgRepeats: n ? attempts.reduce((s, a) => s + a.repeats, 0) / n : 0,
    avgAnswerMs: n ? attempts.reduce((s, a) => s + a.answerMs, 0) / n : 0,
    weak: weak.map(({ badness: _, ...w }) => w),
    hardest: attempts.filter((a) => a.repeats > 0).sort((a, b) => b.repeats - a.repeats).slice(0, 8),
  };
}
