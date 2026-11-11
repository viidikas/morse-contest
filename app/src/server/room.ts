// Session logic for one room. Pure: the current time and the random sources
// are passed in, so the same code can be tested without a clock or a network.

import { kochChars, makeTiming, buildTimeline, type Timeline } from '../engine/morse.js';
import { makeRng, randomGroups } from '../engine/content.js';
import { scoreGroup, type GroupScore } from '../engine/score.js';

export interface RoomConfig {
  /** Sessions start on the clock at multiples of this interval. */
  intervalMs: number;
  /** A session is never scheduled sooner than this, so there is time to join. */
  minLobbyMs: number;
  level: number;
  charWpm: number;
  effWpm: number;
  pauseMs: number;
  groupCount: number;
  /** How far ahead of playback group text is handed to browsers. */
  lookaheadMs: number;
  /** Answers are accepted this long after a group's deadline (network delay). */
  graceMs: number;
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
  groups: string[];
  timeline: Timeline;
  participants: Map<string, Participant>;
}

export type Phase = 'lobby' | 'running' | 'finished';

export interface StateView {
  now: number;
  phase: Phase;
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

export type ResultView =
  | { ready: false }
  | { ready: true; scores: GroupScore[]; attemptedFrom: number; board: BoardRow[]; nextStartAt: number };

const ONLINE_MS = 6000;
const KEEP_MS = 60 * 60 * 1000;
const MAX_NAME = 20;
const MAX_ANSWER = 20;
const MAX_PARTICIPANTS = 500;

export class Room {
  private sessions = new Map<number, Session>();
  private byToken = new Map<string, Session>();

  constructor(
    private cfg: RoomConfig,
    private makeToken: () => string,
    private makeSeed: () => number,
  ) {}

  /** The running session if there is one, otherwise the next one to start. */
  private activeSession(now: number): Session {
    let upcoming: Session | undefined;
    for (const s of this.sessions.values()) {
      if (s.startAt <= now && now < s.startAt + s.timeline.totalMs) return s;
      if (s.startAt > now && (!upcoming || s.startAt < upcoming.startAt)) upcoming = s;
    }
    return upcoming ?? this.create(this.nextStart(now));
  }

  private nextStart(now: number): number {
    return Math.ceil((now + this.cfg.minLobbyMs) / this.cfg.intervalMs) * this.cfg.intervalMs;
  }

  private create(startAt: number): Session {
    const c = this.cfg;
    const groups = randomGroups(makeRng(this.makeSeed()), kochChars(c.level), {
      count: c.groupCount,
      newestWeight: 2,
    });
    const timeline = buildTimeline(groups, makeTiming(c.charWpm, c.effWpm), c.pauseMs);
    if (timeline.totalMs + c.graceMs + c.minLobbyMs > c.intervalMs) {
      throw new Error('Session does not fit in the interval between sessions');
    }
    const session: Session = { startAt, groups, timeline, participants: new Map() };
    this.sessions.set(startAt, session);
    return session;
  }

  /** Forget sessions that ended long ago. */
  prune(now: number): void {
    for (const [key, s] of this.sessions) {
      if (now > s.startAt + s.timeline.totalMs + KEEP_MS) {
        for (const token of s.participants.keys()) this.byToken.delete(token);
        this.sessions.delete(key);
      }
    }
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
    const token = this.makeToken();
    session.participants.set(token, {
      name,
      token,
      answers: new Array<string>(session.groups.length).fill(''),
      attemptedFrom,
      lastSeen: now,
    });
    this.byToken.set(token, session);
    return { token };
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
      startAt: s.startAt,
      totalMs: s.timeline.totalMs,
      groupCount: s.groups.length,
      charWpm: this.cfg.charWpm,
      effWpm: this.cfg.effWpm,
      chars: kochChars(this.cfg.level),
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
      scores: score(me),
      attemptedFrom: me.attemptedFrom,
      board: rows,
      nextStartAt: this.activeSession(now).startAt,
    };
  }
}
