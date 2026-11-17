// Real callsigns for practice, from the Super Check Partial list (MASTER.SCP),
// the list of active contest callsigns that logging programs use.
//
// The file has no stated licence, so it is not kept in the repository and is
// never handed to the browser whole: the server downloads it from the source,
// as logging programs do, and gives out a few random callsigns at a time.

import * as https from 'node:https';
import { existsSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { MORSE } from '../engine/morse.js';

export const SCP_URL = 'https://www.supercheckpartial.com/MASTER.SCP';
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // the list is updated every few days
const RETRY_MS = 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

export type Region = 'all' | 'es';
export const REGIONS: readonly Region[] = ['all', 'es'];

/** Callsigns from an SCP file: comments dropped, only characters we can send. */
export function parseScp(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const call = raw.trim().toUpperCase();
    if (!call || call.startsWith('#') || call.startsWith('!')) continue;
    if (call.length < 3 || call.length > 10) continue;
    if (![...call].every((c) => MORSE[c])) continue;
    if (!/\d/.test(call)) continue; // every callsign has a digit
    out.add(call);
  }
  return [...out];
}

export const inRegion = (call: string, region: Region): boolean =>
  region === 'all' || (region === 'es' && /^ES\d/.test(call));

function download(url: string, redirects = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30_000 }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) req.destroy(new Error('too-large'));
        else chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

export class Callsigns {
  private calls: string[] = [];
  private byRegion = new Map<Region, string[]>();
  private lastTry = 0;
  private busy = false;

  constructor(private file: string, private now: () => number = Date.now) {
    if (existsSync(file)) this.use(readFileSync(file, 'utf8'));
  }

  get size(): number {
    return this.calls.length;
  }

  private use(text: string): boolean {
    const calls = parseScp(text);
    if (calls.length < 1000) return false; // not a real list: keep what we have
    this.calls = calls;
    this.byRegion = new Map(REGIONS.map((r) => [r, calls.filter((c) => inRegion(c, r))]));
    return true;
  }

  /** Downloads the list when it is missing or a week old. Safe to call often. */
  async refresh(): Promise<void> {
    const t = this.now();
    const age = existsSync(this.file) ? t - statSync(this.file).mtimeMs : Infinity;
    if (this.busy || (age < REFRESH_MS && this.calls.length) || t - this.lastTry < RETRY_MS) return;
    this.busy = true;
    this.lastTry = t;
    try {
      const text = await download(SCP_URL);
      if (this.use(text)) {
        writeFileSync(`${this.file}.tmp`, text);
        renameSync(`${this.file}.tmp`, this.file);
        console.log(`Callsigns: ${this.calls.length} loaded from ${SCP_URL}`);
      } else console.log('Callsigns: the downloaded list looked wrong, kept the old one');
    } catch (err) {
      console.log(`Callsigns: download failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /** `count` random callsigns from the region, without repeats when possible. */
  pick(region: Region, count: number, random: () => number = Math.random): string[] {
    const pool = this.byRegion.get(region) ?? [];
    if (pool.length === 0) return [];
    const out = new Set<string>();
    const n = Math.min(count, pool.length);
    while (out.size < n) out.add(pool[Math.floor(random() * pool.length)]);
    return [...out];
  }
}
