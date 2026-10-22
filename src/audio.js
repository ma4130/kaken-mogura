export class GameAudio {
  constructor() {
    this.context = null;
    this.enabled = localStorage.getItem('mogura-sound') !== 'off';
  }

  async unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
    } catch {
      this.context = null;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem('mogura-sound', enabled ? 'on' : 'off');
    if (enabled) void this.unlock();
  }

  tone(frequency, duration = 0.1, { type = 'sine', volume = 0.035, delay = 0 } = {}) {
    if (!this.enabled || !this.context) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  tick(value) {
    this.tone(value === 1 ? 620 : 440, 0.09, { type: 'square', volume: 0.025 });
  }

  go() {
    this.tone(523, 0.14, { type: 'triangle', volume: 0.04 });
    this.tone(784, 0.22, { type: 'triangle', volume: 0.035, delay: 0.1 });
  }

  spawn(gold = false) {
    this.tone(gold ? 740 : 230, 0.07, { type: 'sine', volume: gold ? 0.025 : 0.012 });
  }

  hit(gold = false, combo = 1) {
    const base = gold ? 720 : 420 + Math.min(combo, 8) * 18;
    this.tone(base, 0.1, { type: 'square', volume: 0.035 });
    this.tone(base * 1.5, 0.19, { type: 'triangle', volume: 0.025, delay: 0.055 });
  }

  end() {
    [659, 523, 392].forEach((frequency, index) => {
      this.tone(frequency, 0.34, { type: 'triangle', volume: 0.03, delay: index * 0.13 });
    });
  }
}

