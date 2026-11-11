// All rooms together, plus the rule about who may enter which room.
//
// Rooms above beginner are open only to people who passed that level's solo
// qualification test. Passing yields a "pass": a short signed string the
// browser keeps and shows when joining. Until accounts exist, the pass is the
// proof; later it will be stored with the account instead.

import { LEVELS, PASS_ACCURACY, levelById, levelChars, levelRank } from '../engine/levels.js';
import { Room, type RoomConfig, type ResultView, type StateView } from './room.js';

const PASS_VALID_MS = 180 * 24 * 60 * 60 * 1000;

export interface LevelInfo {
  id: string;
  chars: string;
  charWpm: number;
  effWpm: number;
  requiresTest: boolean;
  startAt: number;
  running: boolean;
  people: number;
}

export type ContestResult =
  | ResultView
  | (ResultView & { ready: true; passed: boolean; threshold: number; pass?: string });

export class Contest {
  private rooms = new Map<string, Room>();

  constructor(
    cfg: RoomConfig,
    makeToken: () => string,
    makeSeed: () => number,
    /** Signs a string with a secret only the server knows. */
    private sign: (data: string) => string,
  ) {
    for (const level of LEVELS) this.rooms.set(level.id, new Room(level, cfg, makeToken, makeSeed));
  }

  private roomOf(token: string): Room | undefined {
    return this.rooms.get(token.split('.', 1)[0]);
  }

  prune(now: number): void {
    for (const room of this.rooms.values()) room.prune(now);
  }

  levels(now: number): { now: number; passAccuracy: number; levels: LevelInfo[] } {
    return {
      now,
      passAccuracy: PASS_ACCURACY,
      levels: LEVELS.map((l) => ({
        id: l.id,
        chars: levelChars(l),
        charWpm: l.charWpm,
        effWpm: l.effWpm,
        requiresTest: l.requiresTest,
        ...this.rooms.get(l.id)!.info(now),
      })),
    };
  }

  makePass(levelId: string, now: number): string {
    const body = `${levelId}.${Math.floor(now + PASS_VALID_MS)}`;
    return `${body}.${this.sign(body)}`;
  }

  /** True if `pass` is genuine, not expired, and for this level or a harder one. */
  passAllows(pass: string, levelId: string, now: number): boolean {
    // Format: level.expiry.signature (the signature itself may contain dots).
    const i = pass.indexOf('.');
    const j = pass.indexOf('.', i + 1);
    if (i < 1 || j < 0) return false;
    const passLevel = pass.slice(0, i);
    const expiry = pass.slice(i + 1, j);
    const signature = pass.slice(j + 1);
    if (!expiry || !signature) return false;
    if (signature !== this.sign(`${passLevel}.${expiry}`)) return false;
    if (!(Number(expiry) > now)) return false;
    return levelRank(passLevel) >= levelRank(levelId) && levelRank(passLevel) >= 0;
  }

  join(levelId: string, name: string, pass: string, now: number): { token: string } | { error: string } {
    const level = levelById(levelId);
    if (!level) return { error: 'unknown-level' };
    if (level.requiresTest && !this.passAllows(pass, levelId, now)) return { error: 'not-qualified' };
    return this.rooms.get(levelId)!.join(name, now);
  }

  /** Starts the solo qualification test for a level. */
  qualify(levelId: string, now: number): { token: string } | { error: string } {
    const level = levelById(levelId);
    if (!level || !level.requiresTest) return { error: 'unknown-level' };
    return this.rooms.get(levelId)!.startSolo(now);
  }

  state(token: string, now: number, from: number): StateView | null {
    return this.roomOf(token)?.state(token, now, from) ?? null;
  }

  answer(token: string, index: number, text: string, now: number): { ok: boolean; reason?: string } {
    return this.roomOf(token)?.answer(token, index, text, now) ?? { ok: false, reason: 'unknown-token' };
  }

  result(token: string, now: number): ContestResult | null {
    const result = this.roomOf(token)?.result(token, now) ?? null;
    if (!result || !result.ready || !result.solo) return result;
    const passed = result.accuracy >= PASS_ACCURACY;
    return {
      ...result,
      passed,
      threshold: PASS_ACCURACY,
      ...(passed ? { pass: this.makePass(result.level, now) } : {}),
    };
  }
}
