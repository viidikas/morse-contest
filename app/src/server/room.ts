// Session logic for one room (one level). Pure: the current time and the
// random sources are passed in, so the same code can be tested without a
// clock or a network.
//
// A room runs two kinds of sessions:
//  - shared sessions, starting on the clock, that anyone admitted may join;
//  - solo sessions, started on request for one person: the qualification test.

import { makeTiming, buildTimeline, type Timeline } from '../engine/morse.js';
import { makeRng, randomGroups, coverageGroups } from '../engine/content.js';
import { scoreGroup, type GroupScore } from '../engine/score.js';
import { levelChars, testRepeats, type LevelDef } from '../engine/levels.js';

export interface RoomConfig {
  /** Shared sessions start on the clock at multiples of this interval. */
  intervalMs: number;
  /** A session is never scheduled sooner than this, so there is time to join. */
  minLobbyMs: number;
  pauseMs: number;
  groupCount: number;
  /** How far ahead of playback group text is handed to browsers. */
  lookaheadMs: number;
  /** Answers are accepted this long after a group's deadline (network delay). */
  graceMs: number;
  /** Delay between asking for a solo test and its first tone. */
  soloLeadMs: number;
}

interface Participant {
  name: string;
  token: string;
  answers: string[];
  /** Index of the first group this participant could have heard in full. */
  attemptedFrom: number;
  lastSeen: number;
}

interface Session {
  startAt: number;
  solo: boolean;
  groups: string[];
  timeline: Timeline;
  participants: Map<string, Participant>;
}

export type Phase = 'lobby' | 'running' | 'finished';

export interface StateView {
  now: number;
  phase: Phase;
  level: string;
  solo: boolean;
  startAt: number;
  totalMs: number;
  groupCount: number;
  charWpm: number;
  effWpm: number;
  chars: string;
  you: string;
  participants: { name: string; online: boolean; you: boolean }[];
  /** Upcoming groups, released shortly before they are played. */
  groups: { index: number; text: string; startMs: number; deadlineMs: number }[];
}

export interface BoardRow {
  rank: number;
  name: string;
  correct: number;
  total: number;
  /** Accuracy over the groups the participant was present for, 0..1. */
  accuracy: number;
  you: boolean;
}

export interface ReadyResult {
  ready: true;
  level: string;
  solo: boolean;
  scores: GroupScore[];
  attemptedFrom: number;
  /** Own accuracy over the groups attended, 0..1. */
  accuracy: number;
  board: BoardRow[];
  nextStartAt: number;
}
export type ResultView = { ready: false } | ReadyResult;

export interface RoomInfo {
  startAt: number;
  running: boolean;
  /** People in the session that is running or about to start. */
  people: number;
}

const ONLINE_MS = 6000;
const KEEP_MS = 60 * 60 * 1000;
const MAX_NAME = 20;
const MAX_ANSWER = 20;
const MAX_PARTICIPANTS = 500;

export class Room {
  private shared = new Map<number, Session>();
  private solos = new Set<Session>();
  private byToken = new Map<string, Session>();

  constructor(
    readonly level: LevelDef,
    private cfg: RoomConfig,
    private makeToken: () => string,
    private makeSeed: () => number,
  ) {}

  /** The running shared session if there is one, otherwise the next one to start. */
  private activeSession(now: number): Session {
    let upcoming: Session | undefined;
    for (const s of this.shared.values()) {
      if (s.startAt <= now && now < s.startAt + s.timeline.totalMs) return s;
      if (s.startAt > now && (!upcoming || s.startAt < upcoming.startAt)) upcoming = s;
    }
    return upcoming ?? this.createShared(this.nextStart(now));
  }

  private nextStart(now: number): number {
    return Math.ceil((now + this.cfg.minLobbyMs) / this.cfg.intervalMs) * this.cfg.intervalMs;
  }

  private build(startAt: number, solo: boolean, groups: string[]): Session {
    const timing = makeTiming(this.level.charWpm, this.level.effWpm);
    const timeline = buildTimeline(groups, timing, this.cfg.pauseMs);
    return { startAt, solo, groups, timeline, participants: new Map() };
  }

  private createShared(startAt: number): Session {
    const c = this.cfg;
    const groups = randomGroups(makeRng(this.makeSeed()), levelChars(this.level), {
      count: c.groupCount,
      newestWeight: 2,
    });
    const session = this.build(startAt, false, groups);
    if (session.timeline.totalMs + c.graceMs + c.minLobbyMs > c.intervalMs) {
      throw new Error(`A ${this.level.id} session does not fit in the interval between sessions`);
    }
    this.shared.set(startAt, session);
    return session;
  }

  private addParticipant(session: Session, name: string, attemptedFrom: number, now: number): string {
    const token = `${this.level.id}.${this.makeToken()}`;
    session.participants.set(token, {
      name,
      token,
      answers: new Array<string>(session.groups.length).fill(''),
      attemptedFrom,
      lastSeen: now,
    });
    this.byToken.set(token, session);
    return token;
  }

  /** Forget sessions that ended long ago. */
  prune(now: number): void {
    const old = (s: Session) => now > s.startAt + s.timeline.totalMs + KEEP_MS;
    const drop = (s: Session) => {
      for (const token of s.participants.keys()) this.byToken.delete(token);
    };
    for (const [key, s] of this.shared) {
      if (old(s)) {
        drop(s);
        this.shared.delete(key);
      }
    }
    for (const s of this.solos) {
      if (old(s)) {
        drop(s);
        this.solos.delete(s);
      }
    }
  }

  info(now: number): RoomInfo {
    const s = this.activeSession(now);
    return { startAt: s.startAt, running: s.startAt <= now, people: s.participants.size };
  }

  join(rawName: string, now: number): { token: string } | { error: string } {
    const base = [...rawName.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, MAX_NAME).join('');
    if (!base) return { error: 'name-required' };
    const session = this.activeSession(now);
    if (session.participants.size >= MAX_PARTICIPANTS) return { error: 'room-full' };

    const taken = new Set([...session.participants.values()].map((p) => p.name.toLowerCase()));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;

    const elapsed = now - session.startAt;
    let attemptedFrom = 0;
    if (elapsed > 0) {
      const next = session.timeline.groups.find((g) => g.startMs >= elapsed);
      attemptedFrom = next ? next.index : session.groups.length;
    }
    return { token: this.addParticipant(session, name, attemptedFrom, now) };
  }

  /** Starts a private qualification test in which every character appears equally often. */
  startSolo(now: number): { token: string } {
    const groups = coverageGroups(makeRng(this.makeSeed()), levelChars(this.level), testRepeats(this.level));
    const session = this.build(now + this.cfg.soloLeadMs, true, groups);
    this.solos.add(session);
    return { token: this.addParticipant(session, 'solo', 0, now) };
  }

  private phase(s: Session, now: number): Phase {
    if (now < s.startAt) return 'lobby';
    return now < s.startAt + s.timeline.totalMs ? 'running' : 'finished';
  }

  /** `from` is the first group index the browser does not have yet. */
  state(token: string, now: number, from: number): StateView | null {
    const s = this.byToken.get(token);
    const me = s?.participants.get(token);
    if (!s || !me) return null;
    me.lastSeen = now;
    const elapsed = now - s.startAt;
    const first = Math.max(0, Math.floor(from) || 0);
    return {
      now,
      phase: this.phase(s, now),
      level: this.level.id,
      solo: s.solo,
      startAt: s.startAt,
      totalMs: s.timeline.totalMs,
      groupCount: s.groups.length,
      charWpm: this.level.charWpm,
      effWpm: this.level.effWpm,
      chars: levelChars(this.level),
      you: me.name,
      participants: [...s.participants.values()].map((p) => ({
        name: p.name,
        online: now - p.lastSeen < ONLINE_MS,
        you: p === me,
      })),
      groups: s.timeline.groups
        .filter((g) => g.index >= first && g.startMs - elapsed <= this.cfg.lookaheadMs)
        .map((g) => ({ index: g.index, text: g.text, startMs: g.startMs, deadlineMs: g.deadlineMs })),
    };
  }

  answer(token: string, index: number, text: string, now: number): { ok: boolean; reason?: string } {
    const s = this.byToken.get(token);
    const me = s?.participants.get(token);
    if (!s || !me) return { ok: false, reason: 'unknown-token' };
    me.lastSeen = now;
    const slot = Number.isInteger(index) ? s.timeline.groups[index] : undefined;
    if (!slot) return { ok: false, reason: 'bad-index' };
    // A late joiner starts at the first group they could hear in full.
    if (index < me.attemptedFrom) return { ok: false, reason: 'not-joined-yet' };
    const elapsed = now - s.startAt;
    if (elapsed < slot.startMs) return { ok: false, reason: 'too-early' };
    if (elapsed > slot.deadlineMs + this.cfg.graceMs) return { ok: false, reason: 'too-late' };
    me.answers[index] = [...String(text)].slice(0, MAX_ANSWER).join('');
    return { ok: true };
  }

  result(token: string, now: number): ResultView | null {
    const s = this.byToken.get(token);
    const me = s?.participants.get(token);
    if (!s || !me) return null;
    me.lastSeen = now;
    // Wait out the grace period so everyone's last answer has arrived.
    if (now < s.startAt + s.timeline.totalMs + this.cfg.graceMs) return { ready: false };

    const score = (p: Participant) => s.groups.map((g, i) => scoreGroup(g, p.answers[i]));
    const rows = [...s.participants.values()].map((p) => {
      const scores = score(p);
      const correct = scores.reduce((n, x) => n + x.correct, 0);
      const total = scores.reduce((n, x) => n + x.total, 0);
      const attempted = scores.slice(p.attemptedFrom).reduce((n, x) => n + x.total, 0);
      return { name: p.name, correct, total, accuracy: attempted ? correct / attempted : 0, you: p === me, rank: 0 };
    });
    rows.sort((a, b) => b.correct - a.correct || b.accuracy - a.accuracy || a.name.localeCompare(b.name));
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      r.rank = prev && prev.correct === r.correct && prev.accuracy === r.accuracy ? prev.rank : i + 1;
    });

    return {
      ready: true,
      level: this.level.id,
      solo: s.solo,
      scores: score(me),
      attemptedFrom: me.attemptedFrom,
      accuracy: rows.find((r) => r.you)?.accuracy ?? 0,
      board: rows,
      nextStartAt: this.activeSession(now).startAt,
    };
  }
}
