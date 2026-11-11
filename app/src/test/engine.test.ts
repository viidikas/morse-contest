// Engine tests. Run with: npm test
import { MORSE, KOCH_ORDER, kochChars, makeTiming, buildTimeline, charDurationMs } from '../engine/morse.js';
import { makeRng, randomGroups } from '../engine/content.js';
import { scoreGroup, summarize } from '../engine/score.js';

declare const process: { exitCode?: number };

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail: string = ''): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// --- alphabet
check('every Koch character has a code', [...KOCH_ORDER].every((c) => !!MORSE[c]));
check('Koch order has no repeats', new Set(KOCH_ORDER).size === KOCH_ORDER.length);
check('Koch order covers the whole alphabet', KOCH_ORDER.length === Object.keys(MORSE).length);
check('codes are unique', new Set(Object.values(MORSE)).size === Object.keys(MORSE).length);
check('kochChars(2)', kochChars(2) === 'KM');
check('kochChars clamps low', kochChars(0) === 'KM');
check('kochChars clamps high', kochChars(999) === KOCH_ORDER);

// --- timing
const t20 = makeTiming(20);
check('20 WPM dit is 60 ms', near(t20.ditMs, 60));
check('20 WPM char gap is 180 ms', near(t20.charGapMs, 180));
check('20 WPM word gap is 420 ms', near(t20.wordGapMs, 420));
check('E lasts one dit', near(charDurationMs('E', t20), 60));
check('K lasts 9 dits', near(charDurationMs('K', t20), 540));

// The word PARIS plus its word gap is by definition 1/WPM of a minute.
const paris20 = buildTimeline(['PARIS'], t20);
check('PARIS at 20 WPM takes 3 s', near(paris20.totalMs, 3000), String(paris20.totalMs));
const f = makeTiming(20, 10);
const paris10 = buildTimeline(['PARIS'], f);
check('PARIS at 20/10 Farnsworth takes 6 s', near(paris10.totalMs, 6000), String(paris10.totalMs));
check('Farnsworth keeps dit length', near(f.ditMs, 60));
check('Farnsworth stretches gaps 3:7', near(f.charGapMs / f.wordGapMs, 3 / 7));
check('effective speed above char speed is ignored', near(makeTiming(20, 30).charGapMs, 180));

// --- timeline
const tl = buildTimeline(['KM', 'UR', 'ES'], t20, 2000);
check('three groups', tl.groups.length === 3);
check('first group starts at 0', tl.groups[0].startMs === 0);
check('deadline is the next start', tl.groups[0].deadlineMs === tl.groups[1].startMs);
check('gap after audio is 2 s', near(tl.groups[0].deadlineMs - tl.groups[0].audioEndMs, 2000));
check('total is the last deadline', near(tl.totalMs, tl.groups[2].deadlineMs));
check(
  'tones never overlap',
  tl.tones.every((x, i) => i === 0 || x.startMs >= tl.tones[i - 1].startMs + tl.tones[i - 1].durMs - 1e-9),
);
check('tone count matches', tl.tones.length === 3 + 2 + 3 + 3 + 1 + 3);
check('short gap falls back to a word gap', near(buildTimeline(['E', 'E'], t20, 0).groups[1].startMs, 60 + 420));
let threw = false;
try { buildTimeline(['A#'], t20); } catch { threw = true; }
check('unknown character is rejected', threw);

// --- content
const a = randomGroups(makeRng(42), 'KMUR', { count: 50 });
const b = randomGroups(makeRng(42), 'KMUR', { count: 50 });
const c = randomGroups(makeRng(43), 'KMUR', { count: 50 });
check('same seed, same groups', a.join() === b.join());
check('different seed, different groups', a.join() !== c.join());
check('group length 5', a.every((g) => g.length === 5));
check('only allowed characters', a.every((g) => [...g].every((ch) => 'KMUR'.includes(ch))));
check('all characters appear', [...'KMUR'].every((ch) => a.join('').includes(ch)));
const w = randomGroups(makeRng(1), 'KMUR', { count: 400, newestWeight: 3 }).join('');
const share = [...w].filter((ch) => ch === 'R').length / w.length;
check('newest character is favoured', share > 0.42 && share < 0.58, String(share));

// --- scoring
check('perfect copy', scoreGroup('KMURE', 'kmure').correct === 5);
const miss = scoreGroup('KMURE', 'KMRE');
check('one missed character costs one', miss.correct === 4 && miss.ops.filter((o) => o.type === 'miss').length === 1);
const sub = scoreGroup('KMURE', 'KMXRE');
check('substitution', sub.correct === 4 && sub.ops[2].type === 'sub');
const extra = scoreGroup('KMURE', 'KMUURE');
check('extra character keeps the rest correct', extra.correct === 5 && extra.ops.some((o) => o.type === 'extra'));
check('nothing typed', scoreGroup('KMURE', '').correct === 0 && scoreGroup('KMURE', '').ops.length === 5);
check('spaces are ignored', scoreGroup('KMURE', ' km ure ').correct === 5);
check('total is the sent length', scoreGroup('KMURE', 'KMUREXXXX').total === 5);

const sum = summarize([scoreGroup('BBDD', 'BDDD'), scoreGroup('BK', 'DK')]);
check('summary totals', sum.correct === 4 && sum.total === 6);
check('summary accuracy', near(sum.accuracy, 4 / 6));
check('worst character first', sum.chars[0].char === 'B' && sum.chars[0].sent === 3 && sum.chars[0].correct === 1);
check('top confusion', sum.confusions[0].sent === 'B' && sum.confusions[0].typed === 'D' && sum.confusions[0].count === 2);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
