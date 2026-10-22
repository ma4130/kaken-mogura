export const HOLE_CENTERS = Object.freeze([
  { x: 0.18, y: 0.2 },
  { x: 0.5, y: 0.2 },
  { x: 0.82, y: 0.2 },
  { x: 0.18, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.82, y: 0.5 },
  { x: 0.18, y: 0.8 },
  { x: 0.5, y: 0.8 },
  { x: 0.82, y: 0.8 },
]);

export const DEFAULT_CONFIG = Object.freeze({
  countdownMs: 3000,
  durationMs: 30000,
  firstSpawnDelayMs: 180,
  startVisibleMs: 1400,
  endVisibleMs: 850,
  startGapMs: 350,
  endGapMs: 220,
  goldChance: 0.12,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;

export class MoleGame {
  constructor(options = {}) {
    this.random = options.random ?? Math.random;
    this.config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
    this.reset();
  }

  reset() {
    this.phase = 'idle';
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.hits = 0;
    this.escaped = 0;
    this.attempts = 0;
    this.responseTotalMs = 0;
    this.target = null;
    this.countdownEndsAt = 0;
    this.runStartsAt = null;
    this.runEndsAt = 0;
    this.nextSpawnAt = 0;
    this.targetSequence = 0;
    this.recentHoles = [];
    this.events = [];
  }

  start(now = performance.now()) {
    this.reset();
    this.phase = 'countdown';
    this.countdownEndsAt = now + this.config.countdownMs;
    this.runStartsAt = this.countdownEndsAt;
    this.runEndsAt = this.runStartsAt + this.config.durationMs;
    this.nextSpawnAt = this.runStartsAt + this.config.firstSpawnDelayMs;
    this.events.push({ type: 'start', at: now });
    return this.snapshot(now);
  }

  stop(now = performance.now(), reason = 'stopped') {
    if (this.phase !== 'running' && this.phase !== 'countdown') return false;
    this.finish(now, reason);
    return true;
  }

  update(now = performance.now()) {
    if (this.phase === 'countdown' && now >= this.countdownEndsAt) {
      this.phase = 'running';
      this.events.push({ type: 'go', at: now });
    }

    if (this.phase !== 'running') return this.snapshot(now);

    if (now >= this.runEndsAt) {
      this.finish(now, 'time');
      return this.snapshot(now);
    }

    if (this.target && now >= this.target.expiresAt) {
      if (this.target.kind !== 'gold') this.combo = 0;
      this.escaped += 1;
      this.events.push({ type: 'escape', target: this.target, at: now });
      this.target = null;
      this.nextSpawnAt = now + this.currentGap(now);
    }

    if (!this.target && now >= this.nextSpawnAt) this.spawn(now);
    return this.snapshot(now);
  }

  hit(holeIndex, now = performance.now(), source = 'camera') {
    if (this.phase !== 'running') return { type: 'ignored', reason: this.phase };
    this.attempts += 1;
    if (!this.target || this.target.hole !== holeIndex || now >= this.target.expiresAt) {
      const miss = { type: 'miss', hole: holeIndex, source, at: now };
      this.events.push(miss);
      return miss;
    }

    const target = this.target;
    const points = target.kind === 'gold' ? 300 : 100;
    const responseMs = Math.max(0, now - target.spawnedAt);
    this.score += points;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.hits += 1;
    this.responseTotalMs += responseMs;
    this.target = null;
    this.nextSpawnAt = now + this.currentGap(now);
    const hit = { type: 'hit', target, points, responseMs, source, at: now };
    this.events.push(hit);
    return hit;
  }

  spawn(now) {
    const progress = this.progress(now);
    const hole = this.chooseHole();
    const kind = progress > 0.28 && this.random() < this.config.goldChance ? 'gold' : 'mole';
    const visibleMs = lerp(this.config.startVisibleMs, this.config.endVisibleMs, progress);
    this.target = {
      id: ++this.targetSequence,
      hole,
      kind,
      spawnedAt: now,
      expiresAt: now + visibleMs,
    };
    this.recentHoles.push(hole);
    this.recentHoles = this.recentHoles.slice(-2);
    this.events.push({ type: 'spawn', target: this.target, at: now });
  }

  chooseHole() {
    const previous = this.recentHoles.at(-1);
    const beforePrevious = this.recentHoles.at(-2);
    let candidates = HOLE_CENTERS.map((_, index) => index).filter((index) => index !== previous);

    if (previous !== undefined) {
      const origin = HOLE_CENTERS[previous];
      const safeMoves = candidates.filter((index) => {
        const next = HOLE_CENTERS[index];
        return Math.hypot(next.x - origin.x, next.y - origin.y) < 0.72;
      });
      if (safeMoves.length) candidates = safeMoves;
    }

    if (previous === beforePrevious && candidates.length > 1) {
      candidates = candidates.filter((index) => index !== previous);
    }
    return candidates[Math.floor(this.random() * candidates.length)] ?? 0;
  }

  currentGap(now) {
    return lerp(this.config.startGapMs, this.config.endGapMs, this.progress(now));
  }

  progress(now) {
    if (this.runStartsAt === null) return 0;
    return clamp((now - this.runStartsAt) / this.config.durationMs, 0, 1);
  }

  remainingMs(now = performance.now()) {
    if (this.phase === 'countdown') return this.config.durationMs;
    if (this.phase === 'running') return Math.max(0, this.runEndsAt - now);
    if (this.phase === 'ended') return 0;
    return this.config.durationMs;
  }

  finish(now, reason) {
    this.phase = 'ended';
    this.target = null;
    this.events.push({ type: 'end', reason, at: now, result: this.result() });
  }

  result() {
    return {
      score: this.score,
      hits: this.hits,
      escaped: this.escaped,
      attempts: this.attempts,
      bestCombo: this.bestCombo,
      accuracy: this.attempts ? Math.round((this.hits / this.attempts) * 100) : 0,
      averageResponseMs: this.hits ? Math.round(this.responseTotalMs / this.hits) : 0,
    };
  }

  snapshot(now = performance.now()) {
    return {
      phase: this.phase,
      score: this.score,
      combo: this.combo,
      target: this.target,
      remainingMs: this.remainingMs(now),
      countdown: this.phase === 'countdown' ? Math.max(1, Math.ceil((this.countdownEndsAt - now) / 1000)) : 0,
      result: this.result(),
    };
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }
}

export function nearestHole(x, y, radius = 0.12) {
  let nearest = null;
  let distance = Number.POSITIVE_INFINITY;
  HOLE_CENTERS.forEach((center, index) => {
    const current = Math.hypot(x - center.x, (y - center.y) * 0.78);
    if (current < distance) {
      distance = current;
      nearest = index;
    }
  });
  return distance <= radius ? nearest : null;
}

