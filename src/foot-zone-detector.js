export class FootZoneDetector {
  constructor({ zoneAt, enterFrames = 2, exitFrames = 2, lostAfterMs = 650 } = {}) {
    if (typeof zoneAt !== 'function') throw new Error('zoneAt callback is required');
    this.zoneAt = zoneAt;
    this.enterFrames = enterFrames;
    this.exitFrames = exitFrames;
    this.lostAfterMs = lostAfterMs;
    this.states = new Map();
  }

  reset() {
    this.states.clear();
  }

  update(points, now) {
    const seen = new Set();
    const activations = new Set();
    points.forEach((point) => {
      seen.add(point.key);
      const zone = this.zoneAt(point);
      let state = this.states.get(point.key);
      if (!state) {
        state = {
          zone,
          candidate: zone,
          frames: 1,
          outsideFrames: zone === null ? this.exitFrames : 0,
          armed: zone === null,
          lastSeen: now,
        };
        this.states.set(point.key, state);
        return;
      }

      state.lastSeen = now;
      if (zone === null) {
        state.outsideFrames += 1;
        state.candidate = null;
        state.frames = 0;
        if (state.outsideFrames >= this.exitFrames) {
          state.zone = null;
          state.armed = true;
        }
        return;
      }

      state.outsideFrames = 0;
      if (zone !== state.candidate) {
        state.candidate = zone;
        state.frames = 1;
        return;
      }
      state.frames += 1;
      if (state.frames >= this.enterFrames && zone !== state.zone) {
        state.zone = zone;
        if (state.armed) {
          activations.add(zone);
          state.armed = false;
        }
      }
    });

    for (const [key, state] of this.states) {
      if (!seen.has(key) && now - state.lastSeen > this.lostAfterMs) this.states.delete(key);
    }
    return [...activations];
  }
}

