// Scoring: compare what was sent with what was typed.

export type Op =
  | { type: 'ok'; sent: string; typed: string }
  | { type: 'sub'; sent: string; typed: string } // wrong character typed
  | { type: 'miss'; sent: string } // character not typed at all
  | { type: 'extra'; typed: string }; // typed something that was not sent

export interface GroupScore {
  sent: string;
  typed: string;
  ops: Op[];
  correct: number;
  total: number;
}

export function normalize(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '');
}

/**
 * Aligns typed text against sent text with the fewest edits, so one missed
 * character costs one character and does not shift everything after it.
 */
export function scoreGroup(sentRaw: string, typedRaw: string): GroupScore {
  const sent = [...normalize(sentRaw)];
  const typed = [...normalize(typedRaw)];
  const n = sent.length;
  const m = typed.length;

  // d[i][j] = fewest edits turning sent[0..i) into typed[0..j)
  const d: number[][] = [];
  for (let i = 0; i <= n; i++) {
    d.push(new Array<number>(m + 1).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = sent[i - 1] === typed[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j - 1] + same, d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }

  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sent[i - 1] === typed[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      ops.push({ type: 'ok', sent: sent[i - 1], typed: typed[j - 1] });
      i--; j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ type: 'sub', sent: sent[i - 1], typed: typed[j - 1] });
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ type: 'miss', sent: sent[i - 1] });
      i--;
    } else {
      ops.push({ type: 'extra', typed: typed[j - 1] });
      j--;
    }
  }
  ops.reverse();

  return {
    sent: sent.join(''),
    typed: typed.join(''),
    ops,
    correct: ops.filter((o) => o.type === 'ok').length,
    total: n,
  };
}

export interface CharStat {
  char: string;
  sent: number;
  correct: number;
}

export interface Confusion {
  sent: string;
  typed: string;
  count: number;
}

export interface Summary {
  correct: number;
  total: number;
  /** 0..1 */
  accuracy: number;
  /** Worst-copied characters first. */
  chars: CharStat[];
  /** Most frequent mix-ups first. */
  confusions: Confusion[];
}

export function summarize(scores: GroupScore[]): Summary {
  const chars = new Map<string, CharStat>();
  const conf = new Map<string, Confusion>();
  let correct = 0;
  let total = 0;
  for (const s of scores) {
    correct += s.correct;
    total += s.total;
    for (const op of s.ops) {
      if (op.type === 'extra') continue;
      const st = chars.get(op.sent) ?? { char: op.sent, sent: 0, correct: 0 };
      st.sent++;
      if (op.type === 'ok') st.correct++;
      chars.set(op.sent, st);
      if (op.type === 'sub') {
        const key = op.sent + op.typed;
        const c = conf.get(key) ?? { sent: op.sent, typed: op.typed, count: 0 };
        c.count++;
        conf.set(key, c);
      }
    }
  }
  return {
    correct,
    total,
    accuracy: total ? correct / total : 0,
    chars: [...chars.values()].sort(
      (a, b) => a.correct / a.sent - b.correct / b.sent || b.sent - a.sent || a.char.localeCompare(b.char),
    ),
    confusions: [...conf.values()].sort((a, b) => b.count - a.count),
  };
}
