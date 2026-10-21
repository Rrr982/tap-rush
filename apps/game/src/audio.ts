/**
 * Tiny synthesised sound effects.
 *
 * No audio files are shipped with the game. Every sound is generated with the
 * Web Audio API, which keeps the bundle small and avoids any loading delay.
 */

export class Sfx {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Must be called from a user gesture, otherwise browsers block audio. */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.context.destination);
    } catch {
      this.context = null;
    }
  }

  hit(streak: number): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master || this.muted) return;

    const now = ctx.currentTime;
    const base = 520 + Math.min(streak, 12) * 26;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.5, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.9, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  miss(): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master || this.muted) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  countdown(): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master || this.muted) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.2);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.4, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.32);
  }
}
