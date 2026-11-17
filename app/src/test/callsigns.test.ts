// Callsign list tests. Run with: npm test
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Callsigns, inRegion, parseScp } from '../server/callsigns.js';

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

const parsed = parseScp('!!Order,1,1\n#\n# Super Check Partial\n2E0AOZ\r\nes1tp\nOH2BH\nDL1ABC/P\nAB\nBAD_CALL\nNODIGIT\nES1TP\n\n');
check('comments and the header line are dropped', !parsed.some((c) => c.startsWith('#') || c.startsWith('!')));
check('callsigns are kept, upper-cased, once each', ['2E0AOZ', 'ES1TP', 'OH2BH', 'DL1ABC/P'].every((c) => parsed.includes(c)) && parsed.length === 4, parsed.join(' '));
check('too short, unsendable and digit-less entries are dropped', !parsed.includes('AB') && !parsed.includes('BAD_CALL') && !parsed.includes('NODIGIT'));

check('Estonian region', inRegion('ES1TP', 'es') && inRegion('ES0IA', 'es') && !inRegion('ESX1', 'es') && !inRegion('OH2BH', 'es'));
check('all region', inRegion('OH2BH', 'all'));

// A list file the class loads on start.
const dir = mkdtempSync(join(tmpdir(), 'scp-'));
try {
  const file = join(dir, 'MASTER.SCP');
  const calls = Array.from({ length: 1200 }, (_, i) => `K${i % 10}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${i}`);
  writeFileSync(file, ['# test', 'ES1TP', 'ES2B', ...calls].join('\n'));
  const list = new Callsigns(file);
  check('loads the saved list', list.size === 1202, String(list.size));
  const es = list.pick('es', 10);
  check('picks only from the region, without repeats', es.length === 2 && es.every((c) => c.startsWith('ES')) && new Set(es).size === 2);
  const all = list.pick('all', 20);
  check('picks the asked number', all.length === 20 && new Set(all).size === 20);

  writeFileSync(file, 'ES1TP\n');
  check('ignores a list that is too short to be real', new Callsigns(file).size === 0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
