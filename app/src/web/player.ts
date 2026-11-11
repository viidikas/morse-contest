// Plays tone timelines with the Web Audio API. One oscillator runs
// continuously and silently; tones are made by scheduling its volume on the
// audio clock, which keeps timing exact regardless of how busy the page is.

import type { Tone } from '../engine/morse.js';

const RAMP_S = 0.005; // soft edges, otherwise every tone starts with a click

export class MorsePlayer {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  /** Must be called from a click or key press: browsers block audio otherwise. */
  async ready(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();
      this.osc.type = 'sine';
      this.gain.gain.value = 0;
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  get isReady(): boolean {
    return this.ctx?.state === 'running';
  }

  /** The audio clock in seconds. All scheduling is relative to this clock. */
  now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Schedules tones with timeline zero placed at audio time `t0`. Tones whose
   * start has already passed are skipped. Successive calls must be for later
   * and later stretches of time.
   */
  schedule(tones: Tone[], t0: number, frequency: number, volume: number): void {
    if (!this.ctx || !this.osc || !this.gain) throw new Error('Call ready() first');
    const g = this.gain.gain;
    const level = Math.max(0, Math.min(1, volume));
    const earliest = this.ctx.currentTime + 0.01;
    this.osc.frequency.value = frequency;
    for (const tone of tones) {
      const on = t0 + tone.startMs / 1000;
      if (on < earliest) continue;
      const off = on + tone.durMs / 1000;
      const ramp = Math.min(RAMP_S, tone.durMs / 4000);
      g.setValueAtTime(0, on);
      g.linearRampToValueAtTime(level, on + ramp);
      g.setValueAtTime(level, off - ramp);
      g.linearRampToValueAtTime(0, off);
    }
  }

  /** Silences everything that is playing or scheduled. */
  stop(): void {
    if (!this.ctx || !this.gain) return;
    this.gain.gain.cancelScheduledValues(0);
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
  }
}
